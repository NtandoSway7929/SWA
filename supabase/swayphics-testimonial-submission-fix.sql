-- SWAYPHICS PUBLIC TESTIMONIAL SUBMISSION FIX
-- Run once in the Supabase SQL Editor.
--
-- The testimonial page submits as the public anonymous role.
-- The existing security setup only granted anon SELECT access,
-- so POST requests were rejected by Postgres/RLS.
--
-- This allows anonymous clients to submit testimonials while
-- preventing the public form from approving a testimonial.

grant insert on table public.testimonials to anon;

drop policy if exists "Public can submit testimonials"
on public.testimonials;

create policy "Public can submit testimonials"
on public.testimonials
for insert
to anon
with check (
    approved is false
);
