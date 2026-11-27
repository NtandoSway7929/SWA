-- Itemised quote pricing, proposal version linkage and atomic invoice conversion.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(36);

select extensions.has_table('public','quote_items','itemised quote line table exists');
select extensions.has_column('public','quotes','invoice_id','quotes have a persisted invoice relationship');
select extensions.has_column('public','quotes','proposal_id','quotes can link to CRM proposals');
select extensions.has_column('public','quotes','proposal_version_id','quotes preserve the exact proposal revision');
select extensions.has_column('public','quote_items','billing_interval','quote items preserve billing frequency');
select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.quote_items'::regclass),
    'RLS is enabled on quote line items'
);
select extensions.ok(
    has_table_privilege('authenticated','public.quote_items','SELECT')
    and not has_table_privilege('authenticated','public.quote_items','INSERT')
    and not has_table_privilege('authenticated','public.quote_items','UPDATE')
    and not has_table_privilege('authenticated','public.quote_items','DELETE')
    and not has_table_privilege('service_role','public.quote_items','SELECT'),
    'quote line items are readable through admin RLS and writable only through security-definer RPCs'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.admin_save_swayphics_quote(uuid,jsonb,jsonb)'::regprocedure),
    'quote save function is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid='public.admin_create_invoice_from_quote(uuid)'::regprocedure),
    'quote conversion function is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    exists(select 1 from pg_indexes where schemaname='public' and indexname='quotes_invoice_id_unique_idx'),
    'an invoice can be linked to only one quote'
);
select extensions.ok(
    (select column_default like '%swayphics_quote_number_seq%'
       from information_schema.columns
      where table_schema='public' and table_name='quotes' and column_name='quote_number'),
    'new quotes receive generated quote numbers'
);
select extensions.is(
    (select count(*)::integer from public.quote_items
      where quote_id='99999999-9999-4999-8999-999999999902'),
    1,
    'legacy flat quotes are migrated to a single itemised line'
);
select extensions.is(
    (select line_total from public.quote_items
      where quote_id='99999999-9999-4999-8999-999999999902'),
    375::numeric,
    'legacy quote amount is preserved by the migration'
);

insert into auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
(
    '99999999-9999-4999-8999-999999999911',
    'authenticated','authenticated','quote-admin@example.invalid','',now(),
    '{}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '99999999-9999-4999-8999-999999999912',
    'authenticated','authenticated','quote-nonadmin@example.invalid','',now(),
    '{}'::jsonb,'{}'::jsonb,now(),now()
);

insert into public.admin_users (user_id,full_name,email,role,active)
values (
    '99999999-9999-4999-8999-999999999911',
    'Quote Pricing QA Admin',
    'quote-admin@example.invalid',
    'owner',
    true
);

insert into public.leads (id,business_name)
values ('99999999-9999-4999-8999-999999999913','Quote Pricing QA Business');

insert into public.clients (id,business_name,source_lead_id)
values (
    '99999999-9999-4999-8999-999999999914',
    'Quote Pricing QA Business',
    '99999999-9999-4999-8999-999999999913'
);

insert into public.services (
    id,name,description,category,pricing_type,default_price,minimum_price,
    maximum_price,price_label,recurring_interval,active
) values
(
    '99999999-9999-4999-8999-999999999915',
    'Website Design',
    'Website design and development.',
    'Web & systems','from',4500,1500,null,'From R1,500','none',true
),
(
    '99999999-9999-4999-8999-999999999916',
    'Social Media Management',
    'Social media management.',
    'Marketing','fixed',1500,1500,1500,'R1,500 / month','monthly',true
);

insert into public.lead_proposals (
    id,lead_id,title,subject,content,created_by
) values (
    '99999999-9999-4999-8999-999999999917',
    '99999999-9999-4999-8999-999999999913',
    'QA Website Proposal',
    'Proposal for QA business',
    'Initial proposal content.',
    '99999999-9999-4999-8999-999999999911'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999911',true);

create temporary table saved_quote_result(result jsonb);
insert into saved_quote_result
select public.admin_save_swayphics_quote(
    null,
    jsonb_build_object(
        'title','QA Website and Marketing Quote',
        'lead_id','99999999-9999-4999-8999-999999999913',
        'client_id','99999999-9999-4999-8999-999999999914',
        'proposal_id','99999999-9999-4999-8999-999999999917',
        'discount',200,
        'vat_rate',15,
        'notes','Quote line and recurrence snapshot QA.'
    ),
    jsonb_build_array(
        jsonb_build_object(
            'service_id','99999999-9999-4999-8999-999999999915',
            'description','Essential website package',
            'quantity',1,
            'unit_price',4500,
            'billing_interval','none'
        ),
        jsonb_build_object(
            'service_id','99999999-9999-4999-8999-999999999916',
            'description','Social media management',
            'quantity',1,
            'unit_price',1500,
            'billing_interval','monthly'
        ),
        jsonb_build_object(
            'service_name','Annual email service',
            'description','Annual email service',
            'quantity',1,
            'unit_price',1200,
            'billing_interval','yearly'
        )
    )
);

select extensions.is(
    (select result->'quote'->>'quote_number' like 'SWQ-%' from saved_quote_result),
    true,
    'new quote receives a generated SWQ quote number'
);
select extensions.is(
    (select result->'quote'->>'proposal_id' from saved_quote_result),
    '99999999-9999-4999-8999-999999999917',
    'quote is linked to its source proposal'
);
select extensions.ok(
    (select (result->'quote'->>'proposal_version_id') is not null from saved_quote_result),
    'quote is linked to the current immutable proposal revision'
);
select extensions.is(
    (select (result->'quote'->>'once_off_subtotal')::numeric from saved_quote_result),
    4500::numeric,
    'once-off line items are subtotalled separately'
);
select extensions.is(
    (select (result->'quote'->>'monthly_recurring_subtotal')::numeric from saved_quote_result),
    1500::numeric,
    'monthly recurring line items are subtotalled separately'
);
select extensions.is(
    (select (result->'quote'->>'yearly_recurring_subtotal')::numeric from saved_quote_result),
    1200::numeric,
    'yearly recurring line items are subtotalled separately'
);
select extensions.is(
    (select (result->'quote'->>'initial_subtotal')::numeric from saved_quote_result),
    7200::numeric,
    'initial subtotal includes once-off charges and the first monthly and yearly periods'
);
select extensions.is(
    (select (result->'quote'->>'discount')::numeric from saved_quote_result),
    200::numeric,
    'initial quote discount is applied to the initial subtotal'
);
select extensions.is(
    (select (result->'quote'->>'vat_amount')::numeric from saved_quote_result),
    1050::numeric,
    'VAT is calculated on the discounted initial subtotal'
);
select extensions.is(
    (select (result->'quote'->>'amount')::numeric from saved_quote_result),
    8050::numeric,
    'legacy quote amount represents the initial amount due including VAT'
);
select extensions.is(
    (select jsonb_array_length(result->'items') from saved_quote_result),
    3,
    'quote save creates three price-snapshot items'
);

create temporary table saved_quote_id(id uuid);
insert into saved_quote_id
select (result->'quote'->>'id')::uuid from saved_quote_result;

update public.services
   set name='Social Management renamed',
       default_price=1750,
       price_label='R1,750 / month',
       updated_at=now()
 where id='99999999-9999-4999-8999-999999999916';

select extensions.is(
    (select service_name_snapshot from public.quote_items
      where quote_id=(select id from saved_quote_id)
        and billing_interval='monthly'),
    'Social Media Management',
    'saved quote preserves the original service-name snapshot'
);
select extensions.is(
    (select unit_price from public.quote_items
      where quote_id=(select id from saved_quote_id)
        and billing_interval='monthly'),
    1500::numeric,
    'catalogue price changes do not rewrite saved quote prices'
);
select extensions.is(
    (select count(*)::integer from public.quote_items
      where quote_id=(select id from saved_quote_id)
        and billing_interval in ('none','monthly','yearly')),
    3,
    'all billing intervals are stored on their own quote items'
);

select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999912',true);
select extensions.is(
    (select count(*)::integer from public.quote_items
      where quote_id=(select id from saved_quote_id)),
    0,
    'non-admin users cannot read quote line items'
);
select extensions.throws_ok(
    format(
        'insert into public.quote_items (quote_id,service_name_snapshot,description) values (%L::uuid,%L,%L)',
        (select id from saved_quote_id),
        'Unauthorized item',
        'Unauthorized item'
    ),
    '42501',
    null,
    'non-admin users cannot directly insert quote line items'
);

select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999911',true);
update public.quotes
   set status='sent'
 where id=(select id from saved_quote_id);

select extensions.throws_ok(
    format(
        'select public.admin_save_swayphics_quote(%L::uuid,%L::jsonb,%L::jsonb)',
        (select id from saved_quote_id),
        '{"title":"Attempted overwrite"}',
        '[{"description":"Changed","quantity":1,"unit_price":1}]'
    ),
    '55000',
    'Only an unconverted draft quote can be edited. Create a new quote for changes.',
    'sent quote line items and prices cannot be overwritten'
);

update public.quotes
   set status='accepted'
 where id=(select id from saved_quote_id);

create temporary table first_invoice_result(result jsonb);
insert into first_invoice_result
select public.admin_create_invoice_from_quote((select id from saved_quote_id));

select extensions.ok(
    (select (result->>'invoice_id') is not null and result->>'already_created'='false'
       from first_invoice_result),
    'accepted quote is converted into a new invoice'
);
select extensions.is(
    (select count(*)::integer from public.invoices),
    1,
    'quote conversion creates exactly one invoice'
);
select extensions.is(
    (select subtotal from public.invoices
      where id=(select (result->>'invoice_id')::uuid from first_invoice_result)),
    7200::numeric,
    'invoice subtotal is copied from the accepted quote initial subtotal'
);
select extensions.is(
    (select discount from public.invoices
      where id=(select (result->>'invoice_id')::uuid from first_invoice_result)),
    200::numeric,
    'invoice discount is copied from the accepted quote'
);
select extensions.is(
    (select vat_amount from public.invoices
      where id=(select (result->>'invoice_id')::uuid from first_invoice_result)),
    1050::numeric,
    'invoice VAT amount is copied from the accepted quote'
);
select extensions.is(
    (select total from public.invoices
      where id=(select (result->>'invoice_id')::uuid from first_invoice_result)),
    8050::numeric,
    'invoice total is equal to the accepted quote initial amount'
);
select extensions.is(
    (select count(*)::integer from public.invoice_items
      where invoice_id=(select (result->>'invoice_id')::uuid from first_invoice_result)),
    3,
    'invoice is created with all quoted service items'
);
select extensions.ok(
    exists (
        select 1 from public.invoice_items
         where invoice_id=(select (result->>'invoice_id')::uuid from first_invoice_result)
           and description like '%(monthly service)'
    )
    and exists (
        select 1 from public.invoice_items
         where invoice_id=(select (result->>'invoice_id')::uuid from first_invoice_result)
           and description like '%(yearly service)'
    ),
    'invoice descriptions preserve the monthly and yearly service cadence'
);
select extensions.is(
    (select invoice_id from public.quotes where id=(select id from saved_quote_id)),
    (select (result->>'invoice_id')::uuid from first_invoice_result),
    'quote stores the successfully created invoice relationship'
);

create temporary table second_invoice_result(result jsonb);
insert into second_invoice_result
select public.admin_create_invoice_from_quote((select id from saved_quote_id));

select extensions.is(
    (select result->>'already_created' from second_invoice_result),
    'true',
    'repeated invoice conversion returns the existing invoice instead of duplicating it'
);
select extensions.is(
    (select count(*)::integer from public.invoices),
    1,
    'repeated conversion does not create a duplicate invoice'
);

reset role;
select * from extensions.finish();
rollback;
