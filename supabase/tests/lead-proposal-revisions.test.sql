-- Immutable lead-proposal revision snapshots and structured proposal content.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(24);

select extensions.has_table('public','lead_proposal_versions','proposal version history table exists');
select extensions.has_column('public','lead_proposals','structured_content','lead proposals have structured JSON content');
select extensions.has_column('public','lead_proposals','current_version','lead proposals expose the current snapshot number');
select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.lead_proposal_versions'::regclass),
    'RLS is enabled on proposal version history'
);
select extensions.ok(
    has_table_privilege('authenticated','public.lead_proposal_versions','SELECT')
    and not has_table_privilege('authenticated','public.lead_proposal_versions','INSERT')
    and not has_table_privilege('authenticated','public.lead_proposal_versions','UPDATE')
    and not has_table_privilege('authenticated','public.lead_proposal_versions','DELETE')
    and not has_table_privilege('service_role','public.lead_proposal_versions','SELECT'),
    'API roles can read via RLS but cannot directly write immutable history'
);
select extensions.ok(
    exists (select 1 from pg_trigger
             where tgrelid='public.lead_proposals'::regclass
               and tgname='trg_capture_lead_proposal_version' and not tgisinternal),
    'proposal writes are connected to the version snapshot trigger'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.prepare_lead_proposal_version()'::regprocedure),
    'version preparation trigger function is SECURITY DEFINER with empty search_path'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.capture_lead_proposal_version()'::regprocedure),
    'snapshot trigger function is SECURITY DEFINER with empty search_path'
);

insert into auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
(
    '99999999-9999-4999-8999-999999999991',
    'authenticated','authenticated','proposal-admin@example.invalid','',now(),
    '{}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '99999999-9999-4999-8999-999999999992',
    'authenticated','authenticated','proposal-nonadmin@example.invalid','',now(),
    '{}'::jsonb,'{}'::jsonb,now(),now()
);

insert into public.admin_users (user_id,full_name,email,role,active)
values (
    '99999999-9999-4999-8999-999999999991',
    'Proposal Revision QA Admin',
    'proposal-admin@example.invalid',
    'owner',
    true
);
insert into public.leads (id,business_name)
values ('99999999-9999-4999-8999-999999999993','Proposal Revision QA Business');

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999991',true);
insert into public.lead_proposals (
    id,lead_id,title,subject,content,assessment_snapshot,created_by
) values (
    '99999999-9999-4999-8999-999999999994',
    '99999999-9999-4999-8999-999999999993',
    'Initial proposal','Proposal subject','Original project overview',
    '{"source":"qa"}'::jsonb,'99999999-9999-4999-8999-999999999991'
);

select extensions.is(
    (select current_version from public.lead_proposals where id='99999999-9999-4999-8999-999999999994'),
    1,'new proposals start at revision snapshot 1'
);
select extensions.is(
    (select count(*)::integer from public.lead_proposal_versions where proposal_id='99999999-9999-4999-8999-999999999994'),
    1,'proposal creation captures the first immutable snapshot'
);
select extensions.is(
    (select content from public.lead_proposal_versions where proposal_id='99999999-9999-4999-8999-999999999994' and version_number=1),
    'Original project overview','the first snapshot preserves the original proposal content'
);

select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999992',true);
select extensions.is(
    (select count(*)::integer from public.lead_proposal_versions),
    0,'non-admin authenticated users cannot read proposal history'
);
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999991',true);

update public.lead_proposals
   set title='Revised proposal',
       content='Updated project overview',
       structured_content=jsonb_build_object(
           'schema_version',1,
           'sections',jsonb_build_object(
               'project_overview','Updated project overview',
               'business_understanding','The business needs a clearer enquiry path'
           )
       ),
       updated_at=now()
 where id='99999999-9999-4999-8999-999999999994';

select extensions.is(
    (select current_version from public.lead_proposals where id='99999999-9999-4999-8999-999999999994'),
    2,'saving structured proposal sections increments the current version'
);
select extensions.is(
    (select structured_content->'sections'->>'business_understanding'
       from public.lead_proposal_versions
      where proposal_id='99999999-9999-4999-8999-999999999994' and version_number=2),
    'The business needs a clearer enquiry path','revision snapshot preserves structured section content'
);

update public.lead_proposals
   set status='approved',
       approved_by='99999999-9999-4999-8999-999999999991',
       approved_at=now()
 where id='99999999-9999-4999-8999-999999999994';

select extensions.is(
    (select current_version from public.lead_proposals where id='99999999-9999-4999-8999-999999999994'),
    3,'approval state is captured as its own immutable snapshot'
);
select extensions.is(
    (select status from public.lead_proposal_versions where proposal_id='99999999-9999-4999-8999-999999999994' and version_number=3),
    'approved','approval snapshot records the approved status'
);

select extensions.throws_ok(
    $$ update public.lead_proposals set content='Unapproved overwrite'
        where id='99999999-9999-4999-8999-999999999994' $$,
    '55000',
    'Create a draft revision before editing an approved or rejected proposal.',
    'approved proposal content cannot be overwritten without reopening a draft revision'
);

reset role;
select extensions.throws_ok(
    $$ update public.lead_proposal_versions set title='Tampered snapshot'
        where proposal_id='99999999-9999-4999-8999-999999999994' and version_number=1 $$,
    '55000','Lead proposal revision history is immutable.','a stored proposal snapshot cannot be updated'
);
select extensions.throws_ok(
    $$ delete from public.lead_proposal_versions
        where proposal_id='99999999-9999-4999-8999-999999999994' and version_number=1 $$,
    '55000','Lead proposal revision history is immutable.','a stored proposal snapshot cannot be deleted'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999991',true);
update public.lead_proposals
   set status='draft',approved_by=null,approved_at=null,updated_at=now()
 where id='99999999-9999-4999-8999-999999999994';

select extensions.is(
    (select current_version from public.lead_proposals where id='99999999-9999-4999-8999-999999999994'),
    3,'opening a new draft revision does not create a duplicate content snapshot'
);

update public.lead_proposals
   set content='Second proposal revision',
       structured_content=jsonb_build_object('schema_version',1,'sections',jsonb_build_object('project_overview','Second proposal revision')),
       updated_at=now()
 where id='99999999-9999-4999-8999-999999999994';

select extensions.is(
    (select current_version from public.lead_proposals where id='99999999-9999-4999-8999-999999999994'),
    4,'saving the reopened draft creates the next immutable revision'
);
select extensions.is(
    (select count(*)::integer from public.lead_proposal_versions where proposal_id='99999999-9999-4999-8999-999999999994'),
    4,'history includes initial draft, saved revision, approval and next revision'
);
select extensions.is(
    (select status from public.lead_proposal_versions where proposal_id='99999999-9999-4999-8999-999999999994' and version_number=3),
    'approved','the earlier approved version remains preserved after reopening a draft'
);
select extensions.is(
    (select changed_by from public.lead_proposal_versions where proposal_id='99999999-9999-4999-8999-999999999994' and version_number=4),
    '99999999-9999-4999-8999-999999999991'::uuid,
    'revision history records the administrator who saved the new version'
);

reset role;
select * from extensions.finish();
rollback;
