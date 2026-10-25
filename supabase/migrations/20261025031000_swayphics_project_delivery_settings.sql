-- Project delivery defaults for Swayphics.
-- Existing projects are not changed; defaults apply to projects inserted after this migration.
begin;

alter table public.workflow_settings
    add column if not exists default_project_duration_days integer not null default 14
        check (default_project_duration_days between 1 and 365),
    add column if not exists default_project_task_template jsonb not null default '[]'::jsonb
        check (jsonb_typeof(default_project_task_template) = 'array');

create or replace function public.validate_swayphics_project_task_template()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_item jsonb;
    v_title text;
    v_offset_text text;
    v_priority text;
begin
    if jsonb_array_length(new.default_project_task_template) > 25 then
        raise exception 'A project task template may contain at most 25 tasks.';
    end if;

    for v_item in
        select item.value
        from jsonb_array_elements(new.default_project_task_template) as item(value)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Each project task template entry must be an object.';
        end if;

        v_title := btrim(coalesce(v_item ->> 'title', ''));
        v_offset_text := coalesce(v_item ->> 'due_offset_days', '');
        v_priority := coalesce(v_item ->> 'priority', 'medium');

        if length(v_title) < 1 or length(v_title) > 120 then
            raise exception 'Project task titles must contain 1 to 120 characters.';
        end if;
        if v_offset_text !~ '^(0|[1-9][0-9]{0,2})$' then
            raise exception 'Task due offsets must be whole days from 0 to 365.';
        end if;
        if v_offset_text::integer > 365 then
            raise exception 'Task due offsets must be whole days from 0 to 365.';
        end if;
        if v_priority not in ('low', 'medium', 'high', 'urgent') then
            raise exception 'Task priority must be low, medium, high, or urgent.';
        end if;
    end loop;

    return new;
end;
$$;

revoke all privileges on function public.validate_swayphics_project_task_template()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_validate_swayphics_project_task_template
    on public.workflow_settings;
create trigger trg_validate_swayphics_project_task_template
before insert or update of default_project_task_template
on public.workflow_settings
for each row execute function public.validate_swayphics_project_task_template();

create or replace function public.apply_swayphics_project_due_date_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_days integer;
begin
    if new.due_date is null then
        select coalesce(ws.default_project_duration_days, 14)
        into v_days
        from public.workflow_settings ws
        where ws.id = 1;

        new.due_date :=
            (coalesce(new.created_at, now()) at time zone 'Africa/Johannesburg')::date
            + coalesce(v_days, 14);
    end if;

    return new;
end;
$$;

create or replace function public.create_swayphics_project_default_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_template jsonb;
    v_item jsonb;
    v_start_date date := (coalesce(new.created_at, now()) at time zone 'Africa/Johannesburg')::date;
    v_title text;
    v_offset integer;
    v_priority text;
begin
    select coalesce(ws.default_project_task_template, '[]'::jsonb)
    into v_template
    from public.workflow_settings ws
    where ws.id = 1;

    if v_template is null or jsonb_array_length(v_template) = 0 then
        return new;
    end if;

    for v_item in
        select item.value
        from jsonb_array_elements(v_template) as item(value)
    loop
        v_title := btrim(coalesce(v_item ->> 'title', ''));
        v_offset := (v_item ->> 'due_offset_days')::integer;
        v_priority := coalesce(v_item ->> 'priority', 'medium');

        insert into public.tasks (
            title, description, assigned_to, client_id, project_id,
            priority, status, due_date
        )
        values (
            v_title,
            'Created from the default Swayphics project checklist.',
            new.assigned_to,
            new.client_id,
            new.id,
            v_priority,
            'todo',
            v_start_date + v_offset
        );
    end loop;

    return new;
end;
$$;

revoke all privileges on function public.apply_swayphics_project_due_date_default()
    from public, anon, authenticated, service_role;
revoke all privileges on function public.create_swayphics_project_default_tasks()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_swayphics_project_due_date_default on public.client_projects;
create trigger trg_swayphics_project_due_date_default
before insert on public.client_projects
for each row execute function public.apply_swayphics_project_due_date_default();

drop trigger if exists trg_swayphics_project_default_tasks on public.client_projects;
create trigger trg_swayphics_project_default_tasks
after insert on public.client_projects
for each row execute function public.create_swayphics_project_default_tasks();

notify pgrst, 'reload schema';
commit;
