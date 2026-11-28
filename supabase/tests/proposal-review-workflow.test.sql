-- Proposal delivery, secure public review, and client decision tests.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(31);

select extensions.has_table('public','quote_review_links',
    'dedicated external proposal review links table exists');
select extensions.has_table('public','quote_review_responses',
    'proposal review responses table exists');
select extensions.has_column('public','quote_review_links','proposal_version_id',
    'each review link binds to one immutable proposal revision');
select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.quote_review_links'::regclass),
    'review links have row-level security enabled'
);
select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.quote_review_responses'::regclass),
    'review responses have row-level security enabled'
);
select extensions.ok(
    has_table_privilege('authenticated','public.quote_review_links','SELECT')
    and not has_table_privilege('authenticated','public.quote_review_links','INSERT')
    and not has_table_privilege('authenticated','public.quote_review_links','UPDATE')
    and not has_table_privilege('authenticated','public.quote_review_links','DELETE'),
    'admins can read review links but cannot mutate them directly'
);
select extensions.ok(
    not has_table_privilege('anon','public.quote_review_links','SELECT')
    and not has_table_privilege('service_role','public.quote_review_links','SELECT'),
    'anonymous and service roles cannot read review link tokens or metadata directly'
);
select extensions.ok(
    has_table_privilege('authenticated','public.quote_review_responses','SELECT')
    and not has_table_privilege('authenticated','public.quote_review_responses','INSERT')
    and not has_table_privilege('authenticated','public.quote_review_responses','UPDATE')
    and not has_table_privilege('authenticated','public.quote_review_responses','DELETE')
    and not has_table_privilege('anon','public.quote_review_responses','SELECT'),
    'review responses are admin-readable and cannot be directly changed'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.admin_issue_swayphics_quote_review(uuid)'::regprocedure),
    'admin issue RPC is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.admin_revoke_swayphics_quote_review(uuid,text)'::regprocedure),
    'admin revoke RPC is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.get_swayphics_quote_review(text)'::regprocedure),
    'public review RPC is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.respond_swayphics_quote_review(text,text,text,text,boolean)'::regprocedure),
    'public response RPC is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    has_function_privilege('authenticated','public.admin_issue_swayphics_quote_review(uuid)','EXECUTE')
    and not has_function_privilege('anon','public.admin_issue_swayphics_quote_review(uuid)','EXECUTE')
    and has_function_privilege('authenticated','public.admin_revoke_swayphics_quote_review(uuid,text)','EXECUTE')
    and not has_function_privilege('anon','public.admin_revoke_swayphics_quote_review(uuid,text)','EXECUTE'),
    'only authenticated sessions can call the admin issue and revoke RPCs'
);
select extensions.ok(
    has_function_privilege('anon','public.get_swayphics_quote_review(text)','EXECUTE')
    and has_function_privilege('anon','public.respond_swayphics_quote_review(text,text,text,text,boolean)','EXECUTE'),
    'anonymous recipients can only use the scoped review and response RPCs'
);

insert into auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
    '99999999-9999-4999-8999-999999999921',
    'authenticated','authenticated','proposal-review-admin@example.invalid','',now(),
    '{}'::jsonb,'{}'::jsonb,now(),now()
);

insert into public.admin_users (user_id,full_name,email,role,active)
values (
    '99999999-9999-4999-8999-999999999921',
    'Proposal Review QA Admin',
    'proposal-review-admin@example.invalid',
    'owner',
    true
);

insert into public.leads (
    id,business_name,contact_name,email,email_consent_required,email_consent_status
) values (
    '99999999-9999-4999-8999-999999999922',
    'Proposal Review QA Business',
    'Review Contact',
    'review-contact@example.invalid',
    false,
    null
);

create temporary table issue_a(result jsonb);
create temporary table get_a(result jsonb);
create temporary table response_a(result jsonb);
create temporary table response_a_retry(result jsonb);
create temporary table saved_b(result jsonb);
create temporary table issue_b(result jsonb);
create temporary table response_b(result jsonb);
create temporary table saved_c(result jsonb);
create temporary table issue_c(result jsonb);
create temporary table get_c(result jsonb);

grant insert,select on issue_a,saved_b,issue_b,saved_c,issue_c to authenticated;
grant insert,select on get_a,response_a,response_a_retry,response_b,get_c to anon;

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999921',true);

insert into public.lead_proposals (
    id,lead_id,title,subject,content,created_by,structured_content
) values (
    '99999999-9999-4999-8999-999999999923',
    '99999999-9999-4999-8999-999999999922',
    'QA Business Website Proposal',
    'Your website proposal',
    'An initial project overview for the QA business.',
    '99999999-9999-4999-8999-999999999921',
    jsonb_build_object(
        'schema_version',1,
        'sections',jsonb_build_object(
            'project_overview','Design and build a clear, conversion-focused business website.',
            'scope_and_deliverables','Website design, development and launch.'
        )
    )
);

update public.lead_proposals
   set status='approved',
       approved_by='99999999-9999-4999-8999-999999999921',
       approved_at=now(),
       updated_at=now()
 where id='99999999-9999-4999-8999-999999999923';

create temporary table saved_quote_a(result jsonb);
insert into saved_quote_a(result)
select public.admin_save_swayphics_quote(
    null,
    jsonb_build_object(
        'title','QA Website Quotation',
        'lead_id','99999999-9999-4999-8999-999999999922',
        'proposal_id','99999999-9999-4999-8999-999999999923',
        'valid_until',(current_date + 7)::text,
        'notes','QA commercial notes.'
    ),
    jsonb_build_array(jsonb_build_object(
        'service_name','Website project',
        'description','Website design and development.',
        'quantity',1,
        'unit_price',1500,
        'billing_interval','none'
    ))
);

select set_config(
    'test.quote_id_a',
    (select result->'quote'->>'id' from saved_quote_a),
    true
);

-- Simulate a draft quotation saved against the earlier draft snapshot.
update public.quotes q
   set proposal_version_id = (
       select pv.id
         from public.lead_proposal_versions pv
        where pv.proposal_id = q.proposal_id
          and pv.version_number = 1
   )
 where q.id = current_setting('test.quote_id_a')::uuid;

select extensions.throws_ok(
    'select public.admin_issue_swayphics_quote_review(current_setting(''test.quote_id_a'')::uuid)',
    '55000',
    'This quote is linked to a different proposal revision. Reopen and save the draft quote against the current approved proposal before sending it.',
    'a quote linked to a superseded proposal revision cannot be issued'
);

-- Explicitly re-saving the draft refreshes its immutable proposal revision
-- link after the administrator has reviewed the approved proposal.
insert into saved_quote_a(result)
select public.admin_save_swayphics_quote(
    q.id,
    jsonb_build_object(
        'title',q.title,
        'lead_id',q.lead_id,
        'client_id',q.client_id,
        'proposal_id',q.proposal_id,
        'valid_until',q.valid_until,
        'notes',q.notes,
        'discount',q.discount,
        'vat_rate',q.vat_rate
    ),
    (
        select jsonb_agg(jsonb_build_object(
            'service_id',qi.service_id,
            'service_name',qi.service_name_snapshot,
            'description',qi.description,
            'price_label',qi.price_label_snapshot,
            'billing_interval',qi.billing_interval,
            'quantity',qi.quantity,
            'unit_price',qi.unit_price
        ) order by qi.position,qi.created_at)
        from public.quote_items qi
        where qi.quote_id=q.id
    )
)
from public.quotes q
where q.id=current_setting('test.quote_id_a')::uuid;

insert into issue_a(result)
select public.admin_issue_swayphics_quote_review(
    current_setting('test.quote_id_a')::uuid
);

select set_config('test.quote_review_token_a',result->>'token',true) from issue_a;
select set_config('test.quote_review_id_a',result->>'review_link_id',true) from issue_a;
select set_config('test.quote_id_a',result->>'quote_id',true) from issue_a;

reset role;

select extensions.ok(
    length(current_setting('test.quote_review_token_a'))=64,
    'admin issue returns a high-entropy single-use review token'
);
select extensions.is(
    (select status from public.quotes where id=current_setting('test.quote_id_a')::uuid),
    'sent',
    'issuing a review link moves the draft quote to sent'
);
select extensions.ok(
    (select q.proposal_version_id = pv.id
       from public.quotes q
       join public.lead_proposals p on p.id=q.proposal_id
       join public.lead_proposal_versions pv
         on pv.proposal_id=p.id and pv.version_number=p.current_version
      where q.id=current_setting('test.quote_id_a')::uuid
        and p.status='approved' and pv.status='approved'),
    'issued quote is bound to the latest approved immutable proposal revision'
);

set local role anon;
insert into get_a(result)
select public.get_swayphics_quote_review(current_setting('test.quote_review_token_a'));
reset role;

select extensions.ok(
    (select (result->>'ok')::boolean from get_a),
    'public review link returns the proposal to its intended recipient'
);
select extensions.is(
    (select result->'proposal'->>'title' from get_a),
    'QA Business Website Proposal',
    'public review shows the exact approved proposal version title'
);
select extensions.ok(
    (select jsonb_array_length(result->'quote'->'items')=1
            and (result->'quote'->'items'->0->>'line_total')::numeric=1500
       from get_a),
    'public review returns itemised commercial details from the linked quote'
);
select extensions.ok(
    (select first_viewed_at is not null
       from public.quote_review_links
      where id=current_setting('test.quote_review_id_a')::uuid),
    'first public view is timestamped on the review link'
);

set local role anon;
insert into response_a(result)
select public.respond_swayphics_quote_review(
    current_setting('test.quote_review_token_a'),
    'accepted',
    'Review Contact',
    'Approved for the next step.',
    true
);
insert into response_a_retry(result)
select public.respond_swayphics_quote_review(
    current_setting('test.quote_review_token_a'),
    'accepted',
    'Review Contact',
    'Approved for the next step.',
    true
);
reset role;

select extensions.ok(
    (select (result->>'success')::boolean and result->>'decision'='accepted'
       from response_a),
    'client acceptance is recorded through the public response RPC'
);
select extensions.is(
    (select status from public.quotes where id=current_setting('test.quote_id_a')::uuid),
    'accepted',
    'client acceptance updates the existing quote status'
);
select extensions.ok(
    exists (
        select 1
          from public.quote_review_responses r
          join public.quotes q on q.id=r.quote_id
         where r.quote_id=current_setting('test.quote_id_a')::uuid
           and r.proposal_version_id=q.proposal_version_id
           and r.decision='accepted'
    ),
    'acceptance record preserves the exact proposal revision the client reviewed'
);
select extensions.ok(
    (select (result->>'already_submitted')::boolean from response_a_retry),
    'repeated submission is idempotent and does not create a second response'
);
select extensions.throws_ok(
    'update public.quote_review_responses set message = ''Tampered'' where quote_id = current_setting(''test.quote_id_a'')::uuid',
    '55000',
    'Quote review responses are immutable.',
    'review response records cannot be edited after submission'
);

insert into saved_b(result)
select public.admin_save_swayphics_quote(
    null,
    jsonb_build_object(
        'title','QA Revised Commercial Quotation',
        'lead_id','99999999-9999-4999-8999-999999999922',
        'proposal_id','99999999-9999-4999-8999-999999999923',
        'valid_until',(current_date + 7)::text
    ),
    jsonb_build_array(jsonb_build_object(
        'service_name','Website project',
        'description','Website design and development.',
        'quantity',1,
        'unit_price',1500,
        'billing_interval','none'
    ))
);

insert into issue_b(result)
select public.admin_issue_swayphics_quote_review((result->'quote'->>'id')::uuid)
from saved_b;

select set_config('test.quote_review_token_b',result->>'token',true) from issue_b;
select set_config('test.quote_id_b',result->>'quote_id',true) from issue_b;

set local role anon;
insert into response_b(result)
select public.respond_swayphics_quote_review(
    current_setting('test.quote_review_token_b'),
    'rejected',
    'Review Contact',
    'We are not proceeding at this time.',
    false
);
reset role;

select extensions.ok(
    (select (result->>'success')::boolean and result->>'decision'='rejected'
       from response_b),
    'client rejection is recorded through the same review workflow'
);
select extensions.is(
    (select status from public.quotes where id=current_setting('test.quote_id_b')::uuid),
    'rejected',
    'client rejection updates the existing quote status'
);

insert into saved_c(result)
select public.admin_save_swayphics_quote(
    null,
    jsonb_build_object(
        'title','QA Revocable Quotation',
        'lead_id','99999999-9999-4999-8999-999999999922',
        'proposal_id','99999999-9999-4999-8999-999999999923',
        'valid_until',(current_date + 7)::text
    ),
    jsonb_build_array(jsonb_build_object(
        'service_name','Website project',
        'description','Website design and development.',
        'quantity',1,
        'unit_price',1500,
        'billing_interval','none'
    ))
);

insert into issue_c(result)
select public.admin_issue_swayphics_quote_review((result->'quote'->>'id')::uuid)
from saved_c;

select set_config('test.quote_review_token_c',result->>'token',true) from issue_c;
select set_config('test.quote_review_link_id_c',result->>'review_link_id',true) from issue_c;
select set_config('test.quote_id_c',result->>'quote_id',true) from issue_c;

select (public.admin_revoke_swayphics_quote_review(
    current_setting('test.quote_review_link_id_c')::uuid,
    'QA revocation'
)->>'success')::boolean;

select extensions.ok(
    (select status='draft' from public.quotes where id=current_setting('test.quote_id_c')::uuid),
    'revoking an unresponded review link returns its quote to draft'
);

set local role anon;
insert into get_c(result)
select public.get_swayphics_quote_review(current_setting('test.quote_review_token_c'));
reset role;

select extensions.ok(
    (select (result->>'ok')::boolean is false from get_c),
    'revoked review links cannot be used to retrieve proposal content'
);

select * from extensions.finish();
rollback;
