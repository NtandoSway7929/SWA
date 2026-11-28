-- Accepted quote agreement snapshots, lead-to-client conversion, and existing invoice handoff.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(44);

select extensions.has_table('public','swayphics_project_agreements',
    'accepted project agreement snapshot table exists');
select extensions.has_column('public','swayphics_project_agreements','client_id',
    'accepted agreements can be linked to a client after explicit conversion');
select extensions.has_column('public','quote_review_responses','terms_accepted',
    'client review responses persist explicit terms acknowledgement');
select extensions.has_column('public','quote_review_responses','terms_document_sha',
    'client review responses preserve the exact published terms document reference');
select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.swayphics_project_agreements'::regclass),
    'accepted agreement snapshots have row-level security enabled'
);
select extensions.ok(
    has_table_privilege('authenticated','public.swayphics_project_agreements','SELECT')
    and not has_table_privilege('authenticated','public.swayphics_project_agreements','INSERT')
    and not has_table_privilege('authenticated','public.swayphics_project_agreements','UPDATE')
    and not has_table_privilege('authenticated','public.swayphics_project_agreements','DELETE')
    and not has_table_privilege('anon','public.swayphics_project_agreements','SELECT'),
    'agreement snapshots are admin-readable and cannot be directly written or read by anonymous users'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.admin_convert_accepted_quote_to_client(uuid)'::regprocedure),
    'accepted quote client conversion is a security-definer RPC with an empty search_path'
);
select extensions.ok(
    has_function_privilege('authenticated','public.admin_convert_accepted_quote_to_client(uuid)','EXECUTE')
    and not has_function_privilege('anon','public.admin_convert_accepted_quote_to_client(uuid)','EXECUTE'),
    'only authenticated sessions can call accepted quote client conversion'
);
select extensions.ok(
    has_function_privilege('anon','public.respond_swayphics_quote_review(text,text,text,text,boolean)','EXECUTE')
    and has_function_privilege('anon','public.get_swayphics_quote_review(text)','EXECUTE'),
    'public proposal review and response stay on the existing scoped RPCs'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.convert_swayphics_lead_to_client(uuid)'::regprocedure),
    'the existing lead-to-client conversion dependency remains a security-definer function'
);
select extensions.ok(
    has_function_privilege('authenticated','public.admin_create_invoice_from_quote(uuid)','EXECUTE'),
    'the existing accepted quote invoice conversion remains available to administrators'
);

insert into auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
    '99999999-9999-4999-8999-999999999931',
    'authenticated','authenticated','sales-handoff-admin@example.invalid','',now(),
    '{}'::jsonb,'{}'::jsonb,now(),now()
);

insert into public.admin_users (user_id,full_name,email,role,active)
values (
    '99999999-9999-4999-8999-999999999931',
    'Accepted Quote Sales QA Admin',
    'sales-handoff-admin@example.invalid',
    'owner',
    true
);

insert into public.leads (
    id,business_name,contact_name,email,phone,email_consent_required,
    email_consent_status,status,assigned_to,notes
) values (
    '99999999-9999-4999-8999-999999999932',
    'Accepted Quote Sales QA Business',
    'Sales QA Contact',
    'sales-qa-contact@example.invalid',
    '0710000000',
    false,
    null,
    'new',
    '99999999-9999-4999-8999-999999999931',
    'Synthetic lead for accepted quote sales handoff tests.'
);

create temporary table sales_saved_quote(result jsonb);
create temporary table sales_issue_link(result jsonb);
create temporary table sales_accept_response(result jsonb);
create temporary table sales_review_lookup(result jsonb);
create temporary table sales_converted_client(result jsonb);
create temporary table sales_converted_client_retry(result jsonb);
create temporary table sales_invoice_created(result jsonb);
create temporary table sales_invoice_retry(result jsonb);
create temporary table sales_saved_rejected_quote(result jsonb);
create temporary table sales_issue_rejected_link(result jsonb);
create temporary table sales_reject_response(result jsonb);
create temporary table manual_accepted_quote(result jsonb);

grant insert,select on manual_accepted_quote,sales_saved_quote,sales_issue_link,sales_converted_client,
    sales_converted_client_retry,sales_invoice_created,sales_invoice_retry,
    sales_saved_rejected_quote,sales_issue_rejected_link to authenticated;
grant insert,select on sales_accept_response,sales_review_lookup,sales_reject_response to anon;

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999931',true);

insert into public.lead_proposals (
    id,lead_id,title,subject,content,created_by,structured_content
) values (
    '99999999-9999-4999-8999-999999999933',
    '99999999-9999-4999-8999-999999999932',
    'Accepted Quote Sales QA Proposal',
    'Website proposal for the QA business',
    'A website project proposal for the synthetic QA business.',
    '99999999-9999-4999-8999-999999999931',
    jsonb_build_object(
        'schema_version',1,
        'sections',jsonb_build_object(
            'project_overview','Design and build a conversion-focused business website.',
            'scope_and_deliverables','Website design, build and launch.'
        )
    )
);

update public.lead_proposals
   set status='approved',
       approved_by='99999999-9999-4999-8999-999999999931',
       approved_at=now(),
       updated_at=now()
 where id='99999999-9999-4999-8999-999999999933';

insert into sales_saved_quote(result)
select public.admin_save_swayphics_quote(
    null,
    jsonb_build_object(
        'title','Accepted Website Project Quotation',
        'lead_id','99999999-9999-4999-8999-999999999932',
        'proposal_id','99999999-9999-4999-8999-999999999933',
        'valid_until',(current_date + 7)::text,
        'notes','Initial project payment is due before commencement.'
    ),
    jsonb_build_array(jsonb_build_object(
        'service_name','Website Design',
        'description','Website design, build and launch.',
        'quantity',1,
        'unit_price',1500,
        'billing_interval','none'
    ))
);

select set_config(
    'test.sales_quote_id',
    (select result->'quote'->>'id' from sales_saved_quote),
    true
);

insert into sales_issue_link(result)
select public.admin_issue_swayphics_quote_review(
    current_setting('test.sales_quote_id')::uuid
);

select set_config('test.sales_review_token',
    (select result->>'token' from sales_issue_link),true);

reset role;

set local role anon;
insert into sales_accept_response(result)
select public.respond_swayphics_quote_review(
    current_setting('test.sales_review_token'),
    'accepted',
    'Sales QA Contact',
    'Approved. Please proceed with the onboarding steps.',
    true
);
insert into sales_review_lookup(result)
select public.get_swayphics_quote_review(current_setting('test.sales_review_token'));
reset role;

select extensions.ok(
    (select (result->>'success')::boolean and result->>'decision'='accepted'
       from sales_accept_response),
    'the client can accept the exact proposal and commercial quote through the existing public review RPC'
);
select extensions.ok(
    (select (result->>'terms_accepted')::boolean
            and result->>'terms_url'='https://swayphics.co.za/terms-and-conditions/revisions/fa302aec3ab9fd2e8e6458f53726f48cae765e5e/'
       from sales_accept_response),
    'acceptance records explicit acknowledgement of the published Swayphics Terms & Conditions'
);
select extensions.is(
    (select status from public.quotes where id=current_setting('test.sales_quote_id')::uuid),
    'accepted',
    'client acceptance updates the existing quote status'
);
select extensions.is(
    (select count(*)::integer from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    1,
    'acceptance automatically creates one immutable agreement snapshot'
);
select extensions.ok(
    (select agreement_number like 'SWA-AGR-' || to_char(current_date, 'YYYY') || '-%'
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'accepted agreement records receive a generated Swayphics agreement reference'
);
select extensions.ok(
    (select a.proposal_version_id=q.proposal_version_id
       from public.swayphics_project_agreements a
       join public.quotes q on q.id=a.quote_id
      where a.quote_id=current_setting('test.sales_quote_id')::uuid),
    'accepted agreement records the exact immutable proposal revision linked to the quote'
);
select extensions.is(
    (select proposal_snapshot->>'title'
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'Accepted Quote Sales QA Proposal',
    'agreement stores the proposal title snapshot'
);
select extensions.is(
    (select (commercial_snapshot->>'initial_amount_due')::numeric
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    1725::numeric,
    'agreement stores the exact initial commercial amount due'
);
select extensions.is(
    (select jsonb_array_length(commercial_snapshot->'items')
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    1,
    'agreement stores the quote itemised service snapshot'
);
select extensions.is(
    (select terms_url
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'https://swayphics.co.za/terms-and-conditions/revisions/fa302aec3ab9fd2e8e6458f53726f48cae765e5e/',
    'agreement stores the published Swayphics Terms & Conditions URL'
);
select extensions.is(
    (select terms_document_sha
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'e56d3f2fd1e4247dcff5bd40c9340542b1e414fc',
    'agreement stores the exact terms document revision reference'
);
select extensions.ok(
    (select terms_acceptance_statement ilike '%Terms & Conditions%'
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'agreement preserves the exact terms acceptance statement'
);
select extensions.ok(
    (select accepted_by_name='Sales QA Contact'
            and accepted_by_email='sales-qa-contact@example.invalid'
            and accepted_at is not null
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'agreement preserves respondent identity and acceptance timestamp'
);
select extensions.ok(
    (select client_id is null
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'client acceptance does not prematurely create or assign a client record'
);
select extensions.ok(
    (select (result->'response'->>'terms_accepted')::boolean
            and result->'response'->>'terms_document_sha'='e56d3f2fd1e4247dcff5bd40c9340542b1e414fc'
       from sales_review_lookup),
    'the public review page can retrieve the recorded terms acknowledgement after acceptance'
);
select extensions.ok(
    (public.respond_swayphics_quote_review(
        current_setting('test.sales_review_token'),
        'accepted',
        'Sales QA Contact',
        'Approved. Please proceed with the onboarding steps.',
        true
    )->>'already_submitted')::boolean
    and (public.respond_swayphics_quote_review(
        current_setting('test.sales_review_token'),
        'accepted',
        'Sales QA Contact',
        'Approved. Please proceed with the onboarding steps.',
        true
    )->>'terms_accepted')::boolean
    and public.respond_swayphics_quote_review(
        current_setting('test.sales_review_token'),
        'accepted',
        'Sales QA Contact',
        'Approved. Please proceed with the onboarding steps.',
        true
    )->>'terms_document_sha'='e56d3f2fd1e4247dcff5bd40c9340542b1e414fc',
    'repeated acceptance returns the same Terms acknowledgement metadata'
);

select extensions.throws_ok(
    'update public.swayphics_project_agreements set agreement_title = ''Tampered'' where quote_id = current_setting(''test.sales_quote_id'')::uuid',
    '55000',
    'Accepted project agreement records are immutable.',
    'accepted agreement snapshots cannot be edited'
);
select extensions.throws_ok(
    'update public.quotes set client_id = ''99999999-9999-4999-8999-999999999934'' where id = current_setting(''test.sales_quote_id'')::uuid',
    '55000',
    'Only draft quotes can be edited. Create a new quote for changes.',
    'accepted quote client association cannot be changed by a direct database update'
);

set local role authenticated;

insert into sales_converted_client(result)
select public.admin_convert_accepted_quote_to_client(current_setting('test.sales_quote_id')::uuid);

select set_config('test.sales_client_id',
    (select result->>'client_id' from sales_converted_client),true);

reset role;

select extensions.ok(
    (select (result->>'success')::boolean
            and (result->>'client_id') is not null
       from sales_converted_client),
    'administrator conversion creates or reuses a client for the accepted lead'
);
select extensions.ok(
    (select q.client_id=current_setting('test.sales_client_id')::uuid
       from public.quotes q
      where q.id=current_setting('test.sales_quote_id')::uuid),
    'accepted quote is associated with the converted client'
);
select extensions.ok(
    (select l.status='won'
            and l.converted_client_id=current_setting('test.sales_client_id')::uuid
       from public.leads l
      where l.id='99999999-9999-4999-8999-999999999932'),
    'existing CRM lead conversion records the won status and converted client reference'
);
select extensions.ok(
    (select client_id=current_setting('test.sales_client_id')::uuid
       from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_quote_id')::uuid),
    'accepted agreement is linked to the converted client without changing its terms snapshot'
);

set local role authenticated;
insert into sales_converted_client_retry(result)
select public.admin_convert_accepted_quote_to_client(current_setting('test.sales_quote_id')::uuid);
reset role;

select extensions.ok(
    (select result->>'client_id'=current_setting('test.sales_client_id')
            and (result->>'already_converted')::boolean
       from sales_converted_client_retry),
    'repeating client conversion is idempotent and reuses the same client record'
);

set local role authenticated;
insert into sales_invoice_created(result)
select public.admin_create_invoice_from_quote(current_setting('test.sales_quote_id')::uuid);
reset role;

select extensions.ok(
    (select result->>'invoice_id' is not null
            and coalesce((result->>'already_created')::boolean,false) is false
       from sales_invoice_created),
    'the existing atomic quote-to-invoice workflow creates the invoice after client conversion'
);
select extensions.is(
    (select total
       from public.invoices
      where id=(select (result->>'invoice_id')::uuid from sales_invoice_created)),
    1725::numeric,
    'existing invoice creation uses the accepted quote initial amount due'
);
select extensions.is(
    (select count(*)::integer
       from public.invoice_items
      where invoice_id=(select (result->>'invoice_id')::uuid from sales_invoice_created)),
    1,
    'existing invoice creation copies the accepted quote itemised service lines'
);
select extensions.ok(
    (select invoice_id=(select (result->>'invoice_id')::uuid from sales_invoice_created)
       from public.quotes
      where id=current_setting('test.sales_quote_id')::uuid),
    'existing invoice conversion links the invoice to its source quote'
);

set local role authenticated;
insert into sales_invoice_retry(result)
select public.admin_create_invoice_from_quote(current_setting('test.sales_quote_id')::uuid);
reset role;

select extensions.ok(
    (select (result->>'already_created')::boolean
            and result->>'invoice_id'=(select result->>'invoice_id' from sales_invoice_created)
       from sales_invoice_retry),
    'repeating quote invoice conversion returns the existing invoice without duplication'
);

set local role authenticated;

insert into sales_saved_rejected_quote(result)
select public.admin_save_swayphics_quote(
    null,
    jsonb_build_object(
        'title','Declined QA Quotation',
        'lead_id','99999999-9999-4999-8999-999999999932',
        'proposal_id','99999999-9999-4999-8999-999999999933',
        'valid_until',(current_date + 7)::text
    ),
    jsonb_build_array(jsonb_build_object(
        'service_name','Website Design',
        'description','Website design and development.',
        'quantity',1,
        'unit_price',1500,
        'billing_interval','none'
    ))
);

select set_config('test.sales_rejected_quote_id',
    (select result->'quote'->>'id' from sales_saved_rejected_quote),true);

insert into sales_issue_rejected_link(result)
select public.admin_issue_swayphics_quote_review(
    current_setting('test.sales_rejected_quote_id')::uuid
);

select set_config('test.sales_rejected_review_token',
    (select result->>'token' from sales_issue_rejected_link),true);

reset role;

set local role anon;
insert into sales_reject_response(result)
select public.respond_swayphics_quote_review(
    current_setting('test.sales_rejected_review_token'),
    'rejected',
    'Sales QA Contact',
    'We are not proceeding with this quotation.',
    false
);
reset role;

select extensions.ok(
    (select (result->>'success')::boolean and result->>'decision'='rejected'
       from sales_reject_response)
    and (select status='rejected' from public.quotes
          where id=current_setting('test.sales_rejected_quote_id')::uuid),
    'client rejection remains recorded through the existing response workflow'
);
select extensions.is(
    (select count(*)::integer from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_rejected_quote_id')::uuid),
    0,
    'a declined quotation does not create an accepted agreement snapshot'
);

set local role authenticated;
select extensions.throws_ok(
    'select public.admin_convert_accepted_quote_to_client(current_setting(''test.sales_rejected_quote_id'')::uuid)',
    '55000',
    'Only an accepted quote can be converted into a client record.',
    'a rejected quotation cannot be converted into a client'
);
reset role;

set local role authenticated;
insert into manual_accepted_quote(result)
select public.admin_save_swayphics_quote(
    null,
    jsonb_build_object(
        'title','Manually Accepted QA Quote',
        'lead_id','99999999-9999-4999-8999-999999999932',
        'proposal_id','99999999-9999-4999-8999-999999999933',
        'valid_until',(current_date + 7)::text
    ),
    jsonb_build_array(jsonb_build_object(
        'service_name','Website Design',
        'description','Website design and development.',
        'quantity',1,
        'unit_price',1500,
        'billing_interval','none'
    ))
);
select set_config(
    'test.sales_manual_quote_id',
    (select result->'quote'->>'id' from manual_accepted_quote),
    true
);
reset role;

update public.quotes
   set status='accepted',
       updated_at=now()
 where id=current_setting('test.sales_manual_quote_id')::uuid;

select extensions.is(
    (select count(*)::integer from public.swayphics_project_agreements
      where quote_id=current_setting('test.sales_manual_quote_id')::uuid),
    0,
    'manually changing quote status does not fabricate a client acceptance agreement'
);

set local role authenticated;
select extensions.throws_ok(
    'select public.admin_convert_accepted_quote_to_client(current_setting(''test.sales_manual_quote_id'')::uuid)',
    '55000',
    'A recorded client acceptance and Terms & Conditions acknowledgement are required before converting this quote into a client.',
    'a manually accepted quote without a recorded agreement cannot be converted into a client'
);
reset role;

select * from extensions.finish();
rollback;
