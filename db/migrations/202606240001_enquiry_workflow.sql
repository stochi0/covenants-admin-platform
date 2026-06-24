create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  external_reference text,
  customer_name text not null,
  customer_email text,
  customer_company text,
  enquiry_type text not null default 'sourcing',
  received_at date not null default current_date,
  notes text,
  resolution text not null default 'open'
    check (resolution in ('open', 'won', 'lost', 'cancelled')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enquiry_items (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  product_id text references public.products(id),
  raw_product_name text,
  raw_cas_number text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    product_id is not null
    or nullif(btrim(raw_product_name), '') is not null
    or nullif(btrim(raw_cas_number), '') is not null
  )
);

create table if not exists public.enquiry_quantities (
  id uuid primary key default gen_random_uuid(),
  enquiry_item_id uuid not null references public.enquiry_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit text not null check (nullif(btrim(unit), '') is not null),
  created_at timestamptz not null default now()
);

create table if not exists public.enquiry_vendors (
  id uuid primary key default gen_random_uuid(),
  enquiry_item_id uuid not null references public.enquiry_items(id) on delete cascade,
  company_id text not null references public.companies(id),
  selected_by uuid not null references public.users(id),
  selected_at timestamptz not null default now(),
  unique (enquiry_item_id, company_id)
);

create table if not exists public.enquiry_dispatches (
  id uuid primary key default gen_random_uuid(),
  enquiry_vendor_id uuid not null references public.enquiry_vendors(id) on delete cascade,
  recipient_emails text[] not null,
  cc_emails text[] not null default '{}',
  subject text not null,
  html_body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  error_message text,
  provider_message_id text,
  attempt_number integer not null default 1 check (attempt_number > 0),
  controlled_acknowledged_by uuid references public.users(id),
  controlled_acknowledged_at timestamptz,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (
    (controlled_acknowledged_by is null and controlled_acknowledged_at is null)
    or (controlled_acknowledged_by is not null and controlled_acknowledged_at is not null)
  )
);

create table if not exists public.vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  enquiry_vendor_id uuid not null references public.enquiry_vendors(id) on delete cascade,
  response_status text not null default 'awaiting'
    check (response_status in ('awaiting', 'quoted', 'declined', 'no_response')),
  price numeric check (price is null or price >= 0),
  currency text,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  packing text,
  hsn_code text,
  notes text,
  outcome text not null default 'pending'
    check (outcome in ('pending', 'shortlisted', 'selected', 'rejected')),
  recorded_by uuid not null references public.users(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enquiry_vendor_id)
);

create table if not exists public.controlled_substances (
  id uuid primary key default gen_random_uuid(),
  cas_number text not null,
  normalized_cas text generated always as (lower(regexp_replace(btrim(cas_number), '\s+', '', 'g'))) stored,
  reason text,
  scomet_entry text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_cas)
);

create index if not exists enquiries_received_at_idx on public.enquiries (received_at desc);
create index if not exists enquiries_resolution_idx on public.enquiries (resolution);
create index if not exists enquiries_customer_search_idx
  on public.enquiries using gin ((coalesce(customer_name, '') || ' ' || coalesce(customer_company, '') || ' ' || coalesce(external_reference, '')) gin_trgm_ops);
create index if not exists enquiry_items_enquiry_id_idx on public.enquiry_items (enquiry_id);
create index if not exists enquiry_items_product_id_idx on public.enquiry_items (product_id);
create index if not exists enquiry_quantities_item_id_idx on public.enquiry_quantities (enquiry_item_id);
create index if not exists enquiry_vendors_item_id_idx on public.enquiry_vendors (enquiry_item_id);
create index if not exists enquiry_vendors_company_id_idx on public.enquiry_vendors (company_id);
create index if not exists enquiry_dispatches_vendor_id_idx on public.enquiry_dispatches (enquiry_vendor_id);
create index if not exists enquiry_dispatches_status_created_idx on public.enquiry_dispatches (status, created_at desc);
create index if not exists vendor_quotes_vendor_id_idx on public.vendor_quotes (enquiry_vendor_id);
create index if not exists controlled_substances_active_cas_idx on public.controlled_substances (normalized_cas) where is_active;
create index if not exists products_name_trgm_idx on public.products using gin (product_name gin_trgm_ops);
create index if not exists products_cas_normalized_idx
  on public.products (lower(regexp_replace(btrim(cas_number), '\s+', '', 'g')));
create index if not exists companies_name_trgm_idx on public.companies using gin (name gin_trgm_ops);

drop trigger if exists set_enquiries_updated_at on public.enquiries;
create trigger set_enquiries_updated_at
before update on public.enquiries
for each row execute function public.set_updated_at();

drop trigger if exists set_enquiry_items_updated_at on public.enquiry_items;
create trigger set_enquiry_items_updated_at
before update on public.enquiry_items
for each row execute function public.set_updated_at();

drop trigger if exists set_vendor_quotes_updated_at on public.vendor_quotes;
create trigger set_vendor_quotes_updated_at
before update on public.vendor_quotes
for each row execute function public.set_updated_at();

drop trigger if exists set_controlled_substances_updated_at on public.controlled_substances;
create trigger set_controlled_substances_updated_at
before update on public.controlled_substances
for each row execute function public.set_updated_at();

create or replace view public.enquiry_workflow as
select
  e.id,
  e.external_reference,
  e.customer_name,
  e.customer_email,
  e.customer_company,
  e.enquiry_type,
  e.received_at,
  e.notes,
  e.resolution,
  e.created_by,
  e.created_at,
  e.updated_at,
  count(distinct ei.id)::integer as item_count,
  count(distinct ev.id)::integer as vendor_count,
  count(distinct ed.id) filter (where ed.status = 'sent')::integer as sent_count,
  count(distinct vq.id) filter (where vq.response_status <> 'awaiting')::integer as response_count,
  case
    when e.resolution <> 'open' then initcap(e.resolution)
    when count(distinct vq.id) filter (where vq.response_status <> 'awaiting') > 0 then 'Responses Received'
    when count(distinct ed.id) filter (where ed.status = 'sent') > 0 then 'Sent'
    when count(distinct ev.id) > 0 then 'Sourcing'
    else 'New'
  end as workflow_stage
from public.enquiries e
left join public.enquiry_items ei on ei.enquiry_id = e.id
left join public.enquiry_vendors ev on ev.enquiry_item_id = ei.id
left join public.enquiry_dispatches ed on ed.enquiry_vendor_id = ev.id
left join public.vendor_quotes vq on vq.enquiry_vendor_id = ev.id
group by e.id;
