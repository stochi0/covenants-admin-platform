-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.accreditations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accreditations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.chemistries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chemistries_pkey PRIMARY KEY (id)
);
CREATE TABLE public.companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website text,
  contact_email text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT companies_pkey PRIMARY KEY (id)
);
CREATE TABLE public.facilities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  region_id uuid,
  latitude double precision,
  longitude double precision,
  location USER-DEFINED,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT facilities_pkey PRIMARY KEY (id),
  CONSTRAINT facilities_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT facilities_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id)
);
CREATE TABLE public.facility_accreditations (
  facility_id uuid NOT NULL,
  accreditation_id uuid NOT NULL,
  awarding_body text,
  certificate_number text,
  awarded_at date,
  expires_at date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facility_accreditations_pkey PRIMARY KEY (facility_id, accreditation_id),
  CONSTRAINT facility_accreditations_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id),
  CONSTRAINT facility_accreditations_accreditation_id_fkey FOREIGN KEY (accreditation_id) REFERENCES public.accreditations(id)
);
CREATE TABLE public.facility_chemistries (
  facility_id uuid NOT NULL,
  chemistry_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facility_chemistries_pkey PRIMARY KEY (facility_id, chemistry_id),
  CONSTRAINT facility_chemistries_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id),
  CONSTRAINT facility_chemistries_chemistry_id_fkey FOREIGN KEY (chemistry_id) REFERENCES public.chemistries(id)
);
CREATE TABLE public.facility_products (
  facility_id uuid NOT NULL,
  product_id text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facility_products_pkey PRIMARY KEY (facility_id, product_id),
  CONSTRAINT facility_products_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id),
  CONSTRAINT facility_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.products (
  id text NOT NULL,
  product_name text,
  cas_number text,
  category USER-DEFINED,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id)
);
CREATE TABLE public.regions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  iso_code text,
  name text NOT NULL,
  country text NOT NULL DEFAULT 'IN'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT regions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.spatial_ref_sys (
  srid integer NOT NULL CHECK (srid > 0 AND srid <= 998999),
  auth_name character varying,
  auth_srid integer,
  srtext character varying,
  proj4text character varying,
  CONSTRAINT spatial_ref_sys_pkey PRIMARY KEY (srid)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  email text,
  full_name text,
  role text NOT NULL DEFAULT 'viewer'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
