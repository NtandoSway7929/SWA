-- SWAYPHICS SALES COMMUNICATION OUTCOMES
-- Forward-only, idempotent schema change. Apply only after the existing
-- Swayphics admin workspace schema has created public.communication_logs.
-- Existing entries default to not_recorded; historical intent/results are not inferred.

alter table public.communication_logs
    add column if not exists outcome text not null default 'not_recorded'
        check (outcome in (
            'not_recorded',
            'no_reply_yet',
            'positive_reply',
            'neutral_reply',
            'negative_reply',
            'meeting_agreed',
            'proposal_requested',
            'follow_up_requested',
            'opt_out',
            'opt_in_confirmed',
            'invalid_contact',
            'other'
        ));

comment on column public.communication_logs.outcome is
    'Manually recorded result of this interaction. not_recorded is the default. No reply is not rejection. opt_out suppresses subsequent sales outreach until a later explicit opt_in_confirmed event is recorded.';

notify pgrst, 'reload schema';
