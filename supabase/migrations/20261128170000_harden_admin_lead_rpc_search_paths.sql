begin;

-- These authenticated administrative RPCs perform their own active-admin
-- authorization checks. Their relation and helper-function references are
-- schema-qualified, and auth.uid() is explicitly schema-qualified.
-- Pin resolution to trusted catalog objects without changing grants or logic.

alter function public.convert_swayphics_enquiry_to_lead(uuid)
  set search_path = '';

alter function public.convert_swayphics_lead_to_client(uuid)
  set search_path = '';

alter function public.is_swayphics_admin()
  set search_path = '';

alter function public.set_swayphics_lead_manual_contact(uuid, boolean)
  set search_path = '';

commit;
