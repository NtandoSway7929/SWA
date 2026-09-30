-- SWAYPHICS CLIENT PORTAL HARDENING
-- Run once in the Supabase SQL Editor after the existing portal SQL.
--
-- Adds a 90-day default lifetime to portal links and limits a single
-- portal link to five requests per ten-minute window.

alter table public.client_portal_tokens
    add column if not exists request_count integer not null default 0;

alter table public.client_portal_tokens
    add column if not exists request_window_started_at timestamptz;

update public.client_portal_tokens
set expires_at =
    coalesce(
        expires_at,
        created_at + interval '90 days'
    )
where expires_at is null;

create or replace function public.set_swayphics_portal_token_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.expires_at is null then
        new.expires_at :=
            coalesce(new.created_at, now())
            + interval '90 days';
    end if;

    if new.request_count is null then
        new.request_count := 0;
    end if;

    return new;
end;
$$;

drop trigger if exists client_portal_token_expiry_trigger
    on public.client_portal_tokens;

create trigger client_portal_token_expiry_trigger
before insert on public.client_portal_tokens
for each row
execute function public.set_swayphics_portal_token_expiry();

create or replace function public.submit_client_portal_request(
    p_token text,
    p_subject text,
    p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token public.client_portal_tokens%rowtype;
    v_request public.client_portal_requests%rowtype;
    v_now timestamptz := now();
begin
    select *
    into v_token
    from public.client_portal_tokens
    where token_hash = encode(
        extensions.digest(trim(p_token), 'sha256'),
        'hex'
    )
      and active = true
      and (
          expires_at is null
          or expires_at > v_now
      )
    order by created_at desc
    limit 1
    for update;

    if not found then
        return jsonb_build_object(
            'ok', false,
            'error',
                'This portal link is invalid or has expired.'
        );
    end if;

    if length(trim(coalesce(p_subject, ''))) < 2 then
        return jsonb_build_object(
            'ok', false,
            'error', 'Please enter a subject.'
        );
    end if;

    if length(trim(coalesce(p_message, ''))) < 2 then
        return jsonb_build_object(
            'ok', false,
            'error', 'Please enter a message.'
        );
    end if;

    if (
        v_token.request_window_started_at is null
        or v_token.request_window_started_at
            <= v_now - interval '10 minutes'
    ) then
        update public.client_portal_tokens
        set
            request_count = 0,
            request_window_started_at = v_now
        where id = v_token.id;

        v_token.request_count := 0;
        v_token.request_window_started_at := v_now;
    end if;

    if coalesce(v_token.request_count, 0) >= 5 then
        return jsonb_build_object(
            'ok', false,
            'error',
                'Too many portal requests were sent. Please wait a few minutes and try again.'
        );
    end if;

    insert into public.client_portal_requests (
        client_id,
        subject,
        message
    )
    values (
        v_token.client_id,
        left(trim(p_subject), 180),
        left(trim(p_message), 5000)
    )
    returning * into v_request;

    update public.client_portal_tokens
    set
        request_count = coalesce(request_count, 0) + 1,
        request_window_started_at =
            coalesce(request_window_started_at, v_now),
        last_used_at = v_now
    where id = v_token.id;

    return jsonb_build_object(
        'ok', true,
        'request_id', v_request.id
    );
end;
$$;

revoke all on function public.submit_client_portal_request(text,text,text)
    from public;

grant execute on function public.submit_client_portal_request(text,text,text)
    to anon, authenticated;

notify pgrst, 'reload schema';
