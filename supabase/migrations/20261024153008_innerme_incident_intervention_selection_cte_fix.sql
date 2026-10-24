-- Correct the intervention-selection ranking update.
-- The previous partial alias replacement left an invalid UPDATE target alias and
-- referenced that alias from SET expressions. Move required fields into the CTE
-- and update the target table without an alias.
DO $repair$
DECLARE
  function_ddl text;
BEGIN
  SELECT pg_get_functiondef(
    'public.refresh_innerme_incident_intervention_selection()'::regprocedure
  )
  INTO function_ddl;

  IF position('update public.innerme_incident_intervention_options opt_rowpt_row' IN function_ddl) = 0 THEN
    RAISE EXCEPTION 'Expected stale intervention-selection alias was not found; aborting repair.';
  END IF;

  function_ddl := replace(
    function_ddl,
    $old_cte$select id,
                   row_number() over(
                       order by
                           case when id=v_best_id then 0 else 1 end,
                           selection_score desc,
                           expected_priority_reduction desc,
                           risk_score asc,
                           id
                   )::integer as rank
            from public.innerme_incident_intervention_options
            where incident_id=r.id$old_cte$,
    $new_cte$select source_row.id,
                   source_row.conflict_status,
                   source_row.expected_priority_reduction,
                   row_number() over(
                       order by
                           case when source_row.id=v_best_id then 0 else 1 end,
                           source_row.selection_score desc,
                           source_row.expected_priority_reduction desc,
                           source_row.risk_score asc,
                           source_row.id
                   )::integer as rank
            from public.innerme_incident_intervention_options source_row
            where source_row.incident_id=r.id$new_cte$
  );
  function_ddl := replace(
    function_ddl,
    'update public.innerme_incident_intervention_options opt_rowpt_row',
    'update public.innerme_incident_intervention_options'
  );
  function_ddl := replace(
    function_ddl,
    'when ranked.rank=1 and opt_row.id=v_best_id then',
    'when ranked.rank=1 and ranked.id=v_best_id then'
  );
  function_ddl := replace(
    function_ddl,
    'when opt_row.conflict_status=''blocked'' then',
    'when ranked.conflict_status=''blocked'' then'
  );
  function_ddl := replace(
    function_ddl,
    'when ranked.rank<=3 and opt_row.expected_priority_reduction>0 then',
    'when ranked.rank<=3 and ranked.expected_priority_reduction>0 then'
  );
  function_ddl := replace(
    function_ddl,
    'where opt_row.id=ranked.id;',
    'where innerme_incident_intervention_options.id=ranked.id;'
  );

  IF position('opt_row' IN function_ddl) > 0
     OR position('opt_rowpt_row' IN function_ddl) > 0
     OR position('source_row.conflict_status' IN function_ddl) = 0
     OR position('ranked.conflict_status=''blocked''' IN function_ddl) = 0 THEN
    RAISE EXCEPTION 'Intervention-selection alias correction did not validate; aborting repair.';
  END IF;

  EXECUTE function_ddl;
END
$repair$;
