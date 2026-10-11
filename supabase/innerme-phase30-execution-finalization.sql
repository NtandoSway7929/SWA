-- InnerMe Phase 30: atomic execution finalization and manual recovery
-- Keeps proposal and execution-log terminal states consistent in one transaction.
-- Uncertain side effects remain locked for explicit administrator reconciliation.

CREATE OR REPLACE FUNCTION public.finalize_innerme_action_execution(
    p_proposal_id uuid,
    p_execution_log_id uuid,
    p_outcome text,
    p_result_payload jsonb DEFAULT '{}'::jsonb,
    p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
    v_proposal public.innerme_action_proposals%rowtype;
    v_log public.innerme_action_execution_logs%rowtype;
    v_message text := nullif(trim(coalesce(p_error_message, '')), '');
    v_response jsonb;
    v_rows integer;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_swayphics_admin() THEN
        RAISE EXCEPTION 'Swayphics admin access required.';
    END IF;

    IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded', 'failed', 'uncertain') THEN
        RAISE EXCEPTION 'Execution outcome must be succeeded, failed, or uncertain.';
    END IF;

    IF p_outcome = 'succeeded'
       AND (p_result_payload IS NULL OR jsonb_typeof(p_result_payload) <> 'object') THEN
        RAISE EXCEPTION 'A successful execution requires an object result payload.';
    END IF;

    SELECT * INTO v_proposal
    FROM public.innerme_action_proposals
    WHERE id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The InnerMe action proposal could not be found.';
    END IF;

    SELECT * INTO v_log
    FROM public.innerme_action_execution_logs
    WHERE id = p_execution_log_id
      AND proposal_id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The execution audit record could not be found for this proposal.';
    END IF;

    IF p_outcome = 'succeeded'
       AND v_proposal.status = 'executed'
       AND v_log.status = 'succeeded'
       AND v_proposal.execution_result IS NOT DISTINCT FROM p_result_payload
       AND v_log.response_payload IS NOT DISTINCT FROM p_result_payload THEN
        RETURN jsonb_build_object(
            'ok', true, 'outcome', 'succeeded',
            'proposal_id', p_proposal_id,
            'execution_log_id', p_execution_log_id,
            'idempotent_replay', true
        );
    END IF;

    IF p_outcome = 'failed'
       AND v_proposal.status = 'failed'
       AND v_log.status = 'failed'
       AND v_proposal.error_message IS NOT DISTINCT FROM v_message
       AND v_log.error_message IS NOT DISTINCT FROM v_message THEN
        RETURN jsonb_build_object(
            'ok', true, 'outcome', 'failed',
            'proposal_id', p_proposal_id,
            'execution_log_id', p_execution_log_id,
            'idempotent_replay', true
        );
    END IF;

    IF v_proposal.status <> 'executing' OR v_log.status <> 'started' THEN
        RAISE EXCEPTION 'Execution finalization requires an executing proposal and a started audit record.';
    END IF;

    IF p_outcome = 'uncertain' THEN
        v_response := jsonb_build_object(
            'phase', 'uncertain',
            'external_effect_may_have_occurred', true,
            'observed_result', coalesce(p_result_payload, '{}'::jsonb),
            'detail', coalesce(v_message, 'Execution outcome could not be confirmed.'),
            'observed_at', now()
        );

        UPDATE public.innerme_action_execution_logs
        SET response_payload = v_response,
            error_message = coalesce(v_message, 'Execution outcome is uncertain; manual reconciliation is required.'),
            completed_at = NULL
        WHERE id = p_execution_log_id
          AND proposal_id = p_proposal_id
          AND status = 'started';
        GET DIAGNOSTICS v_rows = ROW_COUNT;

        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Could not persist the uncertain execution checkpoint.';
        END IF;

        UPDATE public.innerme_action_proposals
        SET error_message = coalesce(v_message, 'Execution outcome is uncertain; manual reconciliation is required.'),
            updated_at = now()
        WHERE id = p_proposal_id
          AND status = 'executing';
        GET DIAGNOSTICS v_rows = ROW_COUNT;

        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Could not retain the proposal in its uncertain executing state.';
        END IF;

        RETURN jsonb_build_object(
            'ok', true, 'outcome', 'uncertain',
            'proposal_id', p_proposal_id,
            'execution_log_id', p_execution_log_id,
            'manual_reconciliation_required', true,
            'idempotent_replay', false
        );
    END IF;

    IF coalesce(v_log.response_payload->>'phase', '') = 'uncertain' THEN
        RAISE EXCEPTION 'The execution outcome is uncertain; use the administrator recovery workflow.';
    END IF;

    IF coalesce(v_log.response_payload->>'phase', '') = 'executor_result_observed'
       AND (
           p_outcome <> 'succeeded'
           OR v_log.response_payload->'result' IS DISTINCT FROM p_result_payload
       ) THEN
        RAISE EXCEPTION 'The observed executor result does not match the finalization payload; do not mark this execution successful or failed automatically.';
    END IF;

    IF p_outcome = 'succeeded' THEN
        UPDATE public.innerme_action_proposals
        SET status = 'executed',
            executed_by = auth.uid(),
            executed_at = now(),
            execution_result = p_result_payload,
            error_message = NULL,
            updated_at = now()
        WHERE id = p_proposal_id
          AND status = 'executing';
        GET DIAGNOSTICS v_rows = ROW_COUNT;

        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Could not finalize the action proposal as executed.';
        END IF;

        UPDATE public.innerme_action_execution_logs
        SET status = 'succeeded',
            response_payload = p_result_payload,
            error_message = NULL,
            completed_at = now()
        WHERE id = p_execution_log_id
          AND proposal_id = p_proposal_id
          AND status = 'started';
        GET DIAGNOSTICS v_rows = ROW_COUNT;

        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Could not finalize the execution audit record as succeeded.';
        END IF;

        RETURN jsonb_build_object(
            'ok', true, 'outcome', 'succeeded',
            'proposal_id', p_proposal_id,
            'execution_log_id', p_execution_log_id,
            'idempotent_replay', false
        );
    END IF;

    v_message := coalesce(v_message, 'The controlled action failed before completion.');
    v_response := jsonb_build_object(
        'outcome', 'failed',
        'detail', v_message,
        'observed_result', coalesce(p_result_payload, '{}'::jsonb)
    );

    UPDATE public.innerme_action_proposals
    SET status = 'failed',
        error_message = v_message,
        updated_at = now()
    WHERE id = p_proposal_id
      AND status = 'executing';
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Could not finalize the action proposal as failed.';
    END IF;

    UPDATE public.innerme_action_execution_logs
    SET status = 'failed',
        response_payload = v_response,
        error_message = v_message,
        completed_at = now()
    WHERE id = p_execution_log_id
      AND proposal_id = p_proposal_id
      AND status = 'started';
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Could not finalize the execution audit record as failed.';
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'outcome', 'failed',
        'proposal_id', p_proposal_id,
        'execution_log_id', p_execution_log_id,
        'idempotent_replay', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_innerme_action_execution(uuid, uuid, text, jsonb, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_innerme_action_execution(uuid, uuid, text, jsonb, text)
TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_innerme_action_execution(
    p_proposal_id uuid,
    p_execution_log_id uuid,
    p_resolution text,
    p_result_payload jsonb DEFAULT '{}'::jsonb,
    p_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
    v_proposal public.innerme_action_proposals%rowtype;
    v_log public.innerme_action_execution_logs%rowtype;
    v_result jsonb;
    v_note text := nullif(trim(coalesce(p_resolution_note, '')), '');
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_swayphics_admin() THEN
        RAISE EXCEPTION 'Swayphics admin access required.';
    END IF;

    IF p_resolution IS NULL OR p_resolution NOT IN ('succeeded', 'failed') THEN
        RAISE EXCEPTION 'Recovery resolution must be succeeded or failed.';
    END IF;

    IF v_note IS NULL OR char_length(v_note) < 20 THEN
        RAISE EXCEPTION 'A reconciliation note of at least 20 characters is required.';
    END IF;

    SELECT * INTO v_proposal
    FROM public.innerme_action_proposals
    WHERE id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The InnerMe action proposal could not be found.';
    END IF;

    SELECT * INTO v_log
    FROM public.innerme_action_execution_logs
    WHERE id = p_execution_log_id AND proposal_id = p_proposal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The execution audit record could not be found for this proposal.';
    END IF;

    IF v_proposal.status <> 'executing'
       OR v_log.status <> 'started'
       OR coalesce(v_log.response_payload->>'phase', '') NOT IN ('uncertain', 'executor_result_observed') THEN
        RAISE EXCEPTION 'Only an uncertain or result-checkpointed execution can be resolved through the recovery workflow.';
    END IF;

    IF coalesce(v_log.response_payload->>'phase', '') = 'executor_result_observed'
       AND p_resolution = 'succeeded'
       AND v_log.response_payload->'result' IS DISTINCT FROM coalesce(p_result_payload, '{}'::jsonb) THEN
        RAISE EXCEPTION 'The recovery result does not match the executor result checkpoint.';
    END IF;

    UPDATE public.innerme_action_execution_logs
    SET response_payload = jsonb_build_object(
        'phase', 'recovery_confirmed',
        'previous_uncertain_checkpoint', coalesce(v_log.response_payload, '{}'::jsonb),
        'resolution', p_resolution,
        'resolution_note', v_note,
        'resolved_by', auth.uid(),
        'resolved_at', now()
    )
    WHERE id = p_execution_log_id
      AND proposal_id = p_proposal_id
      AND status = 'started';

    v_result := public.finalize_innerme_action_execution(
        p_proposal_id,
        p_execution_log_id,
        p_resolution,
        CASE WHEN p_resolution = 'succeeded' THEN coalesce(p_result_payload, '{}'::jsonb)
             ELSE jsonb_build_object('resolution_note', v_note) END,
        CASE WHEN p_resolution = 'failed' THEN 'Administrator-confirmed failure: ' || v_note
             ELSE NULL END
    );

    RETURN v_result || jsonb_build_object(
        'recovered', true,
        'resolution_note', v_note
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_innerme_action_execution(uuid, uuid, text, jsonb, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_innerme_action_execution(uuid, uuid, text, jsonb, text)
TO authenticated;

NOTIFY pgrst, 'reload schema';
