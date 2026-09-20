-- SWAYPHICS CLIENT DELETE FIX
-- Run once in Supabase SQL Editor.
-- Removes the legacy trigger that blocked client deletion.

drop trigger if exists trg_prevent_swayphics_client_delete
on public.clients;

drop function if exists public.prevent_swayphics_client_delete();

notify pgrst, 'reload schema';
