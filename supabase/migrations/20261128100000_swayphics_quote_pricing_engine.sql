-- Itemised quote pricing, proposal linkage and atomic invoice conversion.
-- Existing quote amounts are preserved as a one-off legacy line item.

begin;

create sequence if not exists public.swayphics_quote_number_seq
    start with 1
    increment by 1;

alter table public.quotes
    add column if not exists invoice_id uuid,
    add column if not exists proposal_id uuid,
    add column if not exists proposal_version_id uuid,
    add column if not exists once_off_subtotal numeric(12,2) not null default 0,
    add column if not exists monthly_recurring_subtotal numeric(12,2) not null default 0,
    add column if not exists yearly_recurring_subtotal numeric(12,2) not null default 0,
    add column if not exists initial_subtotal numeric(12,2) not null default 0,
    add column if not exists discount numeric(12,2) not null default 0,
    add column if not exists vat_rate numeric(5,2) not null default 0,
    add column if not exists vat_amount numeric(12,2) not null default 0;

alter table public.quotes
    drop constraint if exists quotes_invoice_id_fkey;
alter table public.quotes
    add constraint quotes_invoice_id_fkey
    foreign key (invoice_id) references public.invoices(id) on delete set null;

alter table public.quotes
    drop constraint if exists quotes_proposal_id_fkey;
alter table public.quotes
    add constraint quotes_proposal_id_fkey
    foreign key (proposal_id) references public.lead_proposals(id) on delete set null;

alter table public.quotes
    drop constraint if exists quotes_proposal_version_id_fkey;
alter table public.quotes
    add constraint quotes_proposal_version_id_fkey
    foreign key (proposal_version_id) references public.lead_proposal_versions(id) on delete set null;

alter table public.quotes
    drop constraint if exists quotes_discount_check;
alter table public.quotes
    add constraint quotes_discount_check check (discount >= 0);

alter table public.quotes
    drop constraint if exists quotes_vat_rate_check;
alter table public.quotes
    add constraint quotes_vat_rate_check check (vat_rate >= 0 and vat_rate <= 100);

alter table public.quotes
    drop constraint if exists quotes_pricing_totals_nonnegative_check;
alter table public.quotes
    add constraint quotes_pricing_totals_nonnegative_check
    check (
        once_off_subtotal >= 0
        and monthly_recurring_subtotal >= 0
        and yearly_recurring_subtotal >= 0
        and initial_subtotal >= 0
        and vat_amount >= 0
        and amount >= 0
    );

alter table public.quotes
    alter column quote_number set default (
        'SWQ-' ||
        to_char(current_date, 'YYYY') ||
        '-' ||
        lpad(nextval('public.swayphics_quote_number_seq')::text, 4, '0')
    );

create unique index if not exists quotes_quote_number_unique_idx
    on public.quotes (quote_number)
    where quote_number is not null and btrim(quote_number) <> '';

create unique index if not exists quotes_invoice_id_unique_idx
    on public.quotes (invoice_id)
    where invoice_id is not null;

create index if not exists quotes_proposal_id_created_idx
    on public.quotes (proposal_id, created_at desc)
    where proposal_id is not null;

create table if not exists public.quote_items (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null references public.quotes(id) on delete cascade,
    service_id uuid references public.services(id) on delete set null,
    service_name_snapshot text not null,
    description text not null,
    pricing_type_snapshot text not null default 'custom'
        check (pricing_type_snapshot in ('fixed','range','from','custom')),
    price_label_snapshot text,
    billing_interval text not null default 'none'
        check (billing_interval in ('none','monthly','yearly')),
    quantity numeric(10,2) not null default 1 check (quantity > 0),
    unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
    line_total numeric(12,2)
        generated always as (round(quantity * unit_price, 2)) stored,
    position integer not null default 0 check (position >= 0),
    created_at timestamptz not null default now()
);

create index if not exists quote_items_quote_position_idx
    on public.quote_items (quote_id, position, created_at);

alter table public.quote_items enable row level security;

drop policy if exists "Swayphics admins can view quote items"
    on public.quote_items;
create policy "Swayphics admins can view quote items"
    on public.quote_items
    for select
    to authenticated
    using (public.is_swayphics_admin());

revoke all on table public.quote_items
    from public, anon, authenticated, service_role;
grant select on table public.quote_items to authenticated;

-- Backfill pre-existing flat quotes as one-off lines. This keeps the original
-- quoted amount intact and gives the new editor a real item snapshot to show.
insert into public.quote_items (
    quote_id,
    service_name_snapshot,
    description,
    pricing_type_snapshot,
    price_label_snapshot,
    billing_interval,
    quantity,
    unit_price,
    position
)
select
    q.id,
    'Legacy quote item',
    coalesce(nullif(btrim(q.title), ''), 'Quoted services'),
    'custom',
    'Legacy quote amount',
    'none',
    1,
    q.amount,
    0
from public.quotes q
where not exists (
    select 1 from public.quote_items qi where qi.quote_id = q.id
)
and q.amount > 0;

update public.quotes q
   set once_off_subtotal = q.amount,
       monthly_recurring_subtotal = 0,
       yearly_recurring_subtotal = 0,
       initial_subtotal = q.amount,
       discount = 0,
       vat_rate = 0,
       vat_amount = 0
 where q.initial_subtotal = 0
   and q.amount > 0;

create or replace function public.admin_save_swayphics_quote(
    p_quote_id uuid,
    p_quote jsonb,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_quote public.quotes%rowtype;
    v_quote_id uuid;
    v_lead_id uuid;
    v_client_id uuid;
    v_proposal_id uuid;
    v_proposal_lead_id uuid;
    v_proposal_version_id uuid;
    v_title text;
    v_status text;
    v_valid_until date;
    v_notes text;
    v_discount numeric(12,2);
    v_vat_rate numeric(5,2);
    v_vat_registered boolean;
    v_once_off numeric(12,2);
    v_monthly numeric(12,2);
    v_yearly numeric(12,2);
    v_initial_subtotal numeric(12,2);
    v_vat_amount numeric(12,2);
    v_initial_amount numeric(12,2);
    v_item jsonb;
    v_service public.services%rowtype;
    v_service_id uuid;
    v_service_name text;
    v_description text;
    v_pricing_type text;
    v_price_label text;
    v_billing_interval text;
    v_quantity numeric(10,2);
    v_unit_price numeric(12,2);
    v_position integer := 0;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Only an authenticated Swayphics administrator can save a quote.'
            using errcode = '42501';
    end if;

    if jsonb_typeof(p_quote) is distinct from 'object' then
        raise exception 'Quote details must be supplied as an object.'
            using errcode = '22023';
    end if;

    if jsonb_typeof(p_items) is distinct from 'array'
       or jsonb_array_length(p_items) < 1
       or jsonb_array_length(p_items) > 40 then
        raise exception 'A quote must contain between 1 and 40 line items.'
            using errcode = '22023';
    end if;

    v_title := nullif(btrim(p_quote->>'title'), '');
    if v_title is null then
        raise exception 'A quote title is required.'
            using errcode = '22023';
    end if;

    v_status := coalesce(nullif(p_quote->>'status', ''), 'draft');
    if v_status not in ('draft','sent','accepted','rejected','expired') then
        raise exception 'The selected quote status is not valid.'
            using errcode = '22023';
    end if;

    if p_quote_id is null and v_status <> 'draft' then
        raise exception 'New quotes must be saved as drafts first.'
            using errcode = '55000';
    end if;

    v_lead_id := nullif(p_quote->>'lead_id', '')::uuid;
    v_client_id := nullif(p_quote->>'client_id', '')::uuid;
    v_proposal_id := nullif(p_quote->>'proposal_id', '')::uuid;
    v_valid_until := nullif(p_quote->>'valid_until', '')::date;
    v_notes := nullif(btrim(p_quote->>'notes'), '');

    if v_proposal_id is not null then
        select p.lead_id
          into v_proposal_lead_id
          from public.lead_proposals p
         where p.id = v_proposal_id;

        if not found then
            raise exception 'The linked proposal could not be found.'
                using errcode = '23503';
        end if;

        if v_lead_id is null then
            v_lead_id := v_proposal_lead_id;
        elsif v_lead_id is distinct from v_proposal_lead_id then
            raise exception 'The quote lead must match the linked proposal lead.'
                using errcode = '23514';
        end if;

        select pv.id
          into v_proposal_version_id
          from public.lead_proposal_versions pv
          join public.lead_proposals p on p.id = pv.proposal_id
         where pv.proposal_id = v_proposal_id
           and pv.version_number = p.current_version;

        if v_proposal_version_id is null then
            raise exception 'Save the current proposal draft before linking a quote to it.'
                using errcode = '55000';
        end if;
    end if;

    if v_lead_id is null and v_client_id is null then
        raise exception 'Link the quote to a lead or an existing client.'
            using errcode = '22023';
    end if;

    if v_lead_id is not null and not exists (
        select 1 from public.leads where id = v_lead_id
    ) then
        raise exception 'The selected lead could not be found.'
            using errcode = '23503';
    end if;

    if v_client_id is not null and not exists (
        select 1 from public.clients where id = v_client_id
    ) then
        raise exception 'The selected client could not be found.'
            using errcode = '23503';
    end if;

    if p_quote_id is null then
        insert into public.quotes (
            title, lead_id, client_id, proposal_id, proposal_version_id,
            status, valid_until, notes, amount
        ) values (
            v_title, v_lead_id, v_client_id, v_proposal_id, v_proposal_version_id,
            'draft', v_valid_until, v_notes, 0
        )
        returning * into v_quote;
    else
        select *
          into v_quote
          from public.quotes q
         where q.id = p_quote_id
         for update;

        if not found then
            raise exception 'The quote could not be found.'
                using errcode = 'P0002';
        end if;

        if v_quote.status <> 'draft' or v_quote.invoice_id is not null then
            raise exception 'Only an unconverted draft quote can be edited. Create a new quote for changes.'
                using errcode = '55000';
        end if;

        update public.quotes
           set title = v_title,
               lead_id = v_lead_id,
               client_id = v_client_id,
               proposal_id = v_proposal_id,
               proposal_version_id = v_proposal_version_id,
               valid_until = v_valid_until,
               notes = v_notes,
               updated_at = now()
         where id = p_quote_id
        returning * into v_quote;
    end if;

    delete from public.quote_items where quote_id = v_quote.id;

    for v_item in
        select value from jsonb_array_elements(p_items)
    loop
        v_service_id := nullif(v_item->>'service_id', '')::uuid;
        v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
        v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
        v_description := nullif(btrim(v_item->>'description'), '');

        if v_quantity <= 0 or v_unit_price < 0 then
            raise exception 'Every quote line needs a positive quantity and a non-negative unit price.'
                using errcode = '22023';
        end if;

        if v_service_id is not null then
            select *
              into v_service
              from public.services s
             where s.id = v_service_id
               and s.active = true;

            if not found then
                raise exception 'A selected service is inactive or no longer available.'
                    using errcode = '23503';
            end if;

            v_service_name := v_service.name;
            v_pricing_type := v_service.pricing_type;
            v_price_label := v_service.price_label;
            v_description := coalesce(v_description, v_service.description, v_service.name);
            v_billing_interval := coalesce(
                nullif(v_item->>'billing_interval', ''),
                v_service.recurring_interval,
                'none'
            );
        else
            v_service_name := coalesce(
                nullif(btrim(v_item->>'service_name'), ''),
                v_description,
                'Custom item'
            );
            v_pricing_type := 'custom';
            v_price_label := coalesce(
                nullif(btrim(v_item->>'price_label'), ''),
                'Custom price'
            );
            v_description := coalesce(v_description, v_service_name);
            v_billing_interval := coalesce(
                nullif(v_item->>'billing_interval', ''),
                'none'
            );
        end if;

        if v_billing_interval not in ('none','monthly','yearly') then
            raise exception 'Billing interval must be once-off, monthly or yearly.'
                using errcode = '22023';
        end if;

        insert into public.quote_items (
            quote_id, service_id, service_name_snapshot, description,
            pricing_type_snapshot, price_label_snapshot, billing_interval,
            quantity, unit_price, position
        ) values (
            v_quote.id, v_service_id, v_service_name, v_description,
            v_pricing_type, v_price_label, v_billing_interval,
            v_quantity, v_unit_price, v_position
        );

        v_position := v_position + 1;
    end loop;

    select
        coalesce(sum(qi.line_total) filter (where qi.billing_interval = 'none'), 0),
        coalesce(sum(qi.line_total) filter (where qi.billing_interval = 'monthly'), 0),
        coalesce(sum(qi.line_total) filter (where qi.billing_interval = 'yearly'), 0)
      into v_once_off, v_monthly, v_yearly
      from public.quote_items qi
     where qi.quote_id = v_quote.id;

    v_initial_subtotal := round(v_once_off + v_monthly + v_yearly, 2);
    v_discount := least(
        greatest(coalesce(nullif(p_quote->>'discount', '')::numeric, 0), 0),
        v_initial_subtotal
    );

    select coalesce(s.vat_registered, false)
      into v_vat_registered
      from public.invoice_settings s
     where s.id = 1;
    v_vat_registered := coalesce(v_vat_registered, false);

    v_vat_rate := coalesce(
        nullif(p_quote->>'vat_rate', '')::numeric,
        case when v_vat_registered then 15 else 0 end
    );

    if v_vat_rate < 0 or v_vat_rate > 100 then
        raise exception 'VAT rate must be between 0 and 100 percent.'
            using errcode = '22023';
    end if;

    if not v_vat_registered and v_vat_rate > 0 then
        raise exception 'VAT cannot be added while VAT registration is disabled in Invoice settings.'
            using errcode = '23514';
    end if;

    v_vat_amount := round((v_initial_subtotal - v_discount) * v_vat_rate / 100, 2);
    v_initial_amount := round(v_initial_subtotal - v_discount + v_vat_amount, 2);

    update public.quotes
       set once_off_subtotal = v_once_off,
           monthly_recurring_subtotal = v_monthly,
           yearly_recurring_subtotal = v_yearly,
           initial_subtotal = v_initial_subtotal,
           discount = v_discount,
           vat_rate = v_vat_rate,
           vat_amount = v_vat_amount,
           amount = v_initial_amount,
           status = v_status,
           updated_at = now()
     where id = v_quote.id
    returning * into v_quote;

    return jsonb_build_object(
        'quote', to_jsonb(v_quote),
        'items', coalesce((
            select jsonb_agg(to_jsonb(qi) order by qi.position, qi.created_at)
              from public.quote_items qi
             where qi.quote_id = v_quote.id
        ), '[]'::jsonb)
    );
end;
$function$;

revoke all on function public.admin_save_swayphics_quote(uuid, jsonb, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.admin_save_swayphics_quote(uuid, jsonb, jsonb)
    to authenticated;

create or replace function public.admin_create_invoice_from_quote(
    p_quote_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_quote public.quotes%rowtype;
    v_invoice_id uuid;
    v_invoice_number text;
    v_item_count integer;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Only an authenticated Swayphics administrator can convert a quote to an invoice.'
            using errcode = '42501';
    end if;

    select *
      into v_quote
      from public.quotes q
     where q.id = p_quote_id
     for update;

    if not found then
        raise exception 'The quote could not be found.'
            using errcode = 'P0002';
    end if;

    if v_quote.invoice_id is not null then
        return jsonb_build_object(
            'invoice_id', v_quote.invoice_id,
            'already_created', true
        );
    end if;

    if v_quote.status <> 'accepted' then
        raise exception 'Only accepted quotes can be converted into invoices.'
            using errcode = '55000';
    end if;

    if v_quote.client_id is null then
        raise exception 'Convert the linked lead to a client before creating an invoice.'
            using errcode = '23502';
    end if;

    select count(*)::integer
      into v_item_count
      from public.quote_items qi
     where qi.quote_id = v_quote.id;

    if v_item_count < 1 then
        raise exception 'The accepted quote has no saved line items.'
            using errcode = '23514';
    end if;

    insert into public.invoices (
        client_id,
        issue_date,
        status,
        currency,
        subtotal,
        discount,
        vat_rate,
        vat_amount,
        total,
        amount_paid,
        amount_outstanding,
        notes,
        created_by
    ) values (
        v_quote.client_id,
        current_date,
        'draft',
        'ZAR',
        v_quote.initial_subtotal,
        v_quote.discount,
        v_quote.vat_rate,
        v_quote.vat_amount,
        v_quote.amount,
        0,
        v_quote.amount,
        'Created from accepted quote ' || coalesce(v_quote.quote_number, v_quote.id::text) ||
            '. The invoice includes the first service period for any recurring line items.' ||
            case when v_quote.notes is not null then E'

' || v_quote.notes else '' end,
        auth.uid()
    )
    returning id, invoice_number into v_invoice_id, v_invoice_number;

    insert into public.invoice_items (
        invoice_id,
        service_id,
        description,
        quantity,
        unit_price
    )
    select
        v_invoice_id,
        qi.service_id,
        qi.description ||
            case qi.billing_interval
                when 'monthly' then ' (monthly service)'
                when 'yearly' then ' (yearly service)'
                else ''
            end,
        qi.quantity,
        qi.unit_price
    from public.quote_items qi
    where qi.quote_id = v_quote.id
    order by qi.position, qi.created_at;

    update public.quotes
       set invoice_id = v_invoice_id,
           updated_at = now()
     where id = v_quote.id;

    return jsonb_build_object(
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'already_created', false
    );
end;
$function$;

revoke all on function public.admin_create_invoice_from_quote(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.admin_create_invoice_from_quote(uuid)
    to authenticated;

comment on column public.quotes.amount is
    'Initial amount due: once-off items plus the first monthly/yearly service periods, less the initial discount, plus quoted VAT.';
comment on table public.quote_items is
    'Immutable-by-snapshot commercial lines. Service names, descriptions, prices and billing intervals are captured when a draft quote is saved.';

commit;
