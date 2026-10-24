-- Avoid collision between the PL/pgSQL row variable "o" and SQL alias "o"
-- inside refresh_innerme_incident_intervention_selection().
DO $repair$
DECLARE
  function_ddl text;
BEGIN
  SELECT pg_get_functiondef(
    'public.refresh_innerme_incident_intervention_selection()'::regprocedure
  )
  INTO function_ddl;

  IF position(
    'update public.innerme_incident_intervention_options o'
    IN function_ddl
  ) = 0 THEN
    RAISE EXCEPTION 'Expected intervention-selection update alias was not found; aborting repair.';
  END IF;

  function_ddl := replace(
    function_ddl,
    'update public.innerme_incident_intervention_options o',
    'update public.innerme_incident_intervention_options opt_row'
  );
  function_ddl := replace(
    function_ddl,
    'ranked.rank=1 and o.id=v_best_id',
    'ranked.rank=1 and opt_row.id=v_best_id'
  );
  function_ddl := replace(
    function_ddl,
    'when o.conflict_status=',
    'when opt_row.conflict_status='
  );
  function_ddl := replace(
    function_ddl,
    'and o.expected_priority_reduction>0',
    'and opt_row.expected_priority_reduction>0'
  );
  function_ddl := replace(
    function_ddl,
    'where o.id=ranked.id;',
    'where opt_row.id=ranked.id;'
  );

  IF position('ranked.rank=1 and o.id=v_best_id' IN function_ddl) > 0
     OR position('when o.conflict_status=' IN function_ddl) > 0
     OR position('and o.expected_priority_reduction>0' IN function_ddl) > 0
     OR position('where o.id=ranked.id;' IN function_ddl) > 0 THEN
    RAISE EXCEPTION 'One or more ambiguous aliases remain; aborting repair.';
  END IF;

  EXECUTE function_ddl;
END
$repair$;
