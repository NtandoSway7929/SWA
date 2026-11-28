-- Harden the remaining Supabase-reported mutable function search paths.
-- All object references in these functions are either built-ins or explicitly
-- schema-qualified, so an empty search_path preserves their behaviour.

begin;

create or replace function public.set_lead_proposals_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;

create or replace function public.next_swayphics_invoice_number()
returns text
language sql
set search_path = ''
as $function$
    select
        'SWY-' ||
        to_char(current_date, 'YYYY') ||
        '-' ||
        lpad(nextval('public.swayphics_invoice_number_seq')::text, 4, '0');
$function$;

create or replace function public.touch_admin_push_subscription()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;

create or replace function public.set_swayphics_project_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if new.status = 'completed'
       and (
           tg_op = 'INSERT'
           or old.status is distinct from new.status
       ) then
        new.completed_at = coalesce(
            new.completed_at,
            now()
        );
    end if;

    return new;
end;
$function$;

commit;
