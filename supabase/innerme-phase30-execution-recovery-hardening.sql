-- InnerMe Phase 30 recovery hardening:
-- A confirmed executor-result checkpoint cannot be reconciled as a failure or
-- replaced with a different success payload. Uncertain outcomes still require
-- explicit administrator confirmation and a durable reconciliation note.

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
    v_phase text;
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

    v_phase := coalesce(v_log.response_payload->>'phase', '');

    IF v_proposal.status <> 'executing'
       OR v_log.status <> 'started'
       OR v_phase NOT IN ('uncertain', 'executor_result_observed') THEN
        RAISE EXCEPTION 'Only an uncertain or result-checkpointed execution can be resolved through the recovery workflow.';
    END IF;

    IF v_phase = 'executor_result_observed'
       AND (
           p_resolution <> 'succeeded'
           OR v_log.response_payload->'result' IS DISTINCT FROM coalesce(p_result_payload, '{}'::jsonb)
       ) THEN
        RAISE EXCEPTION 'The recovery resolution must match the successful executor result checkpoint.';
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
