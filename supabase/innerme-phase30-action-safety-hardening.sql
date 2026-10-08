-- Phase 30 follow-up hardening:
-- Prevent direct inserts from bypassing the proposed -> safety-check -> approval lifecycle.

create or replace function public.guard_innerme_action_policy_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
    if new.status is distinct from 'proposed'
       or new.reviewed_by is not null
       or new.approved_at is not null
       or new.executed_by is not null
       or new.executed_at is not null
       or new.execution_result is not null
       or new.error_message is not null then
        raise exception 'Controlled actions must be inserted as unreviewed proposals. Use the policy gate and administrator review workflow.';
    end if;

    return new;
end;
$function$;

revoke all on function public.guard_innerme_action_policy_insert() from public, anon, authenticated;

drop trigger if exists guard_innerme_action_policy_insert
on public.innerme_action_proposals;

create trigger guard_innerme_action_policy_insert
before insert on public.innerme_action_proposals
for each row
execute function public.guard_innerme_action_policy_insert();

notify pgrst,'reload schema';
