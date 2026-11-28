begin;

alter table public.tasks
    drop constraint if exists tasks_status_check;

alter table public.tasks
    add constraint tasks_status_check
    check (status in ('todo', 'in progress', 'review', 'blocked', 'completed'));

comment on constraint tasks_status_check on public.tasks is
    'Supported task workflow states, including blocked work awaiting resolution.';

notify pgrst, 'reload schema';

commit;
