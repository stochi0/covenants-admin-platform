create index if not exists facility_products_product_id_idx
  on public.facility_products (product_id);

create index if not exists facilities_active_company_idx
  on public.facilities (company_id, id)
  where is_active and deleted_at is null;
