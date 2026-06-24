import nodemailer from "nodemailer";
import type { PoolClient } from "pg";

import type { AdminUser } from "./auth.js";
import { enquiryConfig } from "./config.js";
import { getPool } from "./supabase.js";

type JsonRecord = Record<string, unknown>;

interface QuantityInput {
  quantity: number;
  unit: string;
}

interface ItemInput {
  productId?: string | null;
  productName?: string | null;
  casNumber?: string | null;
  remarks?: string | null;
  quantities?: QuantityInput[];
}

interface EnquiryInput {
  externalReference?: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerCompany?: string | null;
  enquiryType?: string | null;
  receivedAt?: string | null;
  notes?: string | null;
  items: ItemInput[];
}

interface ImportRow {
  externalReference?: string;
  customerName?: string;
  customerEmail?: string;
  customerCompany?: string;
  enquiryType?: string;
  receivedAt?: string;
  productName?: string;
  casNumber?: string;
  quantity?: number | string;
  unit?: string;
  remarks?: string;
}

const DEFAULT_CC = enquiryConfig.defaultCcEmails;

export async function listEnquiries(options: {
  limit: number;
  offset: number;
  search?: string;
  stage?: string;
  from?: string;
  to?: string;
}) {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.search?.trim()) {
    params.push(`%${options.search.trim()}%`);
    clauses.push(`(
      customer_name ilike $${params.length}
      or coalesce(customer_company, '') ilike $${params.length}
      or coalesce(external_reference, '') ilike $${params.length}
      or exists (
        select 1
        from public.enquiry_items ei
        left join public.products p on p.id = ei.product_id
        where ei.enquiry_id = enquiry_workflow.id
          and (
            coalesce(p.product_name, ei.raw_product_name, '') ilike $${params.length}
            or coalesce(p.cas_number, ei.raw_cas_number, '') ilike $${params.length}
          )
      )
    )`);
  }
  if (options.stage?.trim()) {
    params.push(options.stage.trim());
    clauses.push(`lower(workflow_stage) = lower($${params.length})`);
  }
  if (options.from) {
    params.push(options.from);
    clauses.push(`received_at >= $${params.length}::date`);
  }
  if (options.to) {
    params.push(options.to);
    clauses.push(`received_at <= $${params.length}::date`);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const countResult = await getPool().query<{ count: string }>(
    `select count(*)::text as count from public.enquiry_workflow ${where}`,
    params
  );
  params.push(options.limit, options.offset);
  const rows = await getPool().query(
    `select *
     from public.enquiry_workflow
     ${where}
     order by received_at desc, created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return { records: rows.rows, total: Number(countResult.rows[0]?.count ?? 0) };
}

export async function getEnquiry(id: string) {
  const enquiryResult = await getPool().query(`select * from public.enquiry_workflow where id = $1`, [id]);
  const enquiry = enquiryResult.rows[0];
  if (!enquiry) {
    throw new Error("Enquiry not found.");
  }

  const [items, vendors] = await Promise.all([
    getPool().query(
      `select
         ei.*,
         coalesce(p.product_name, ei.raw_product_name) as product_name,
         coalesce(p.cas_number, ei.raw_cas_number) as cas_number,
         p.category,
         cs.id is not null as is_controlled,
         cs.reason as controlled_reason,
         cs.scomet_entry,
         coalesce(
           jsonb_agg(distinct jsonb_build_object('id', eq.id, 'quantity', eq.quantity, 'unit', eq.unit))
             filter (where eq.id is not null),
           '[]'::jsonb
         ) as quantities
       from public.enquiry_items ei
       left join public.products p on p.id = ei.product_id
       left join public.controlled_substances cs
         on cs.is_active
        and cs.normalized_cas = lower(regexp_replace(btrim(coalesce(p.cas_number, ei.raw_cas_number)), '\\s+', '', 'g'))
       left join public.enquiry_quantities eq on eq.enquiry_item_id = ei.id
       where ei.enquiry_id = $1
       group by ei.id, p.id, cs.id
       order by ei.created_at`,
      [id]
    ),
    getPool().query(
      `select
         ev.id,
         ev.enquiry_item_id,
         ev.company_id,
         c.name as company_name,
         c.contact_email,
         ev.selected_at,
         latest_dispatch.id as latest_dispatch_id,
         latest_dispatch.status as dispatch_status,
         latest_dispatch.sent_at,
         latest_dispatch.error_message,
         vq.id as quote_id,
         vq.response_status,
         vq.price,
         vq.currency,
         vq.lead_time_days,
         vq.packing,
         vq.hsn_code,
         vq.notes as quote_notes,
         vq.outcome,
         vq.responded_at
       from public.enquiry_vendors ev
       join public.companies c on c.id = ev.company_id
       left join lateral (
         select ed.*
         from public.enquiry_dispatches ed
         where ed.enquiry_vendor_id = ev.id
         order by ed.created_at desc
         limit 1
       ) latest_dispatch on true
       left join public.vendor_quotes vq on vq.enquiry_vendor_id = ev.id
       join public.enquiry_items ei on ei.id = ev.enquiry_item_id
       where ei.enquiry_id = $1
       order by c.name`,
      [id]
    )
  ]);

  return { ...enquiry, items: items.rows, vendors: vendors.rows };
}

export async function createEnquiry(input: EnquiryInput, admin: AdminUser) {
  validateEnquiryInput(input);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const id = await insertEnquiry(client, input, admin.id);
    await client.query("commit");
    return getEnquiry(id);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function importEnquiries(rows: ImportRow[], admin: AdminUser) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("At least one import row is required.");
  }

  const groups = new Map<string, ImportRow[]>();
  rows.forEach((row, index) => {
    const reference = clean(row.externalReference);
    const key = reference ? `ref:${reference.toLowerCase()}` : `row:${index}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  const client = await getPool().connect();
  const ids: string[] = [];
  try {
    await client.query("begin");
    for (const groupRows of groups.values()) {
      const first = groupRows[0] ?? {};
      const input: EnquiryInput = {
        externalReference: clean(first.externalReference),
        customerName: clean(first.customerName) || "Unknown customer",
        customerEmail: clean(first.customerEmail),
        customerCompany: clean(first.customerCompany),
        enquiryType: clean(first.enquiryType) || "sourcing",
        receivedAt: clean(first.receivedAt),
        items: groupRows.map((row) => ({
          productName: clean(row.productName),
          casNumber: clean(row.casNumber),
          remarks: clean(row.remarks),
          quantities:
            Number(row.quantity) > 0 && clean(row.unit)
              ? [{ quantity: Number(row.quantity), unit: clean(row.unit)! }]
              : []
        }))
      };
      validateEnquiryInput(input);
      ids.push(await insertEnquiry(client, input, admin.id));
    }
    await client.query("commit");
    return { created: ids.length, ids };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateEnquiryResolution(id: string, resolution: string) {
  if (!["open", "won", "lost", "cancelled"].includes(resolution)) {
    throw new Error("Invalid enquiry resolution.");
  }
  const result = await getPool().query(
    `update public.enquiries set resolution = $2 where id = $1 returning id`,
    [id, resolution]
  );
  if (!result.rowCount) {
    throw new Error("Enquiry not found.");
  }
  return getEnquiry(id);
}

export async function searchProducts(search: string) {
  const term = search.trim();
  if (!term) return [];
  const result = await getPool().query(
    `select
       p.id,
       p.product_name,
       p.cas_number,
       p.category,
       cs.id is not null as is_controlled,
       cs.reason as controlled_reason,
       cs.scomet_entry
     from public.products p
     left join public.controlled_substances cs
       on cs.is_active
      and cs.normalized_cas = lower(regexp_replace(btrim(p.cas_number), '\\s+', '', 'g'))
     where p.deleted_at is null
       and (p.product_name ilike $1 or p.cas_number ilike $1)
     order by
       case when lower(coalesce(p.cas_number, '')) = lower($2) then 0 else 1 end,
       similarity(coalesce(p.product_name, ''), $2) desc
     limit 20`,
    [`%${term}%`, term]
  );
  return result.rows;
}

export async function getVendorCandidates(itemId: string) {
  const result = await getPool().query(
    `select
       c.id as company_id,
       ev.id as enquiry_vendor_id,
       c.name as company_name,
       c.contact_email,
       count(distinct f.id)::integer as facility_count,
       jsonb_agg(
         distinct jsonb_build_object(
           'id', f.id,
           'name', f.name,
           'address', f.address,
           'isPrimary', fp.is_primary
         )
       ) as facilities,
       bool_or(fp.is_primary) as has_primary_facility,
       ev.id is not null as selected
     from public.enquiry_items ei
     join public.facility_products fp on fp.product_id = ei.product_id
     join public.facilities f
       on f.id = fp.facility_id
      and f.is_active
      and f.deleted_at is null
     join public.companies c on c.id = f.company_id
     left join public.enquiry_vendors ev
       on ev.enquiry_item_id = ei.id
      and ev.company_id = c.id
     where ei.id = $1
       and nullif(btrim(c.contact_email), '') is not null
     group by c.id, ev.id
     order by bool_or(fp.is_primary) desc, count(distinct f.id) desc, c.name`,
    [itemId]
  );
  return result.rows;
}

export async function selectVendors(itemId: string, companyIds: string[], admin: AdminUser) {
  const uniqueIds = [...new Set(companyIds.filter(Boolean))];
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const valid = await client.query<{ company_id: string }>(
      `select distinct c.id as company_id
       from public.enquiry_items ei
       join public.facility_products fp on fp.product_id = ei.product_id
       join public.facilities f on f.id = fp.facility_id and f.is_active and f.deleted_at is null
       join public.companies c on c.id = f.company_id
       where ei.id = $1
         and c.id = any($2::text[])
         and nullif(btrim(c.contact_email), '') is not null`,
      [itemId, uniqueIds]
    );
    const validIds = valid.rows.map((row) => row.company_id);
    await client.query(
      `delete from public.enquiry_vendors
       where enquiry_item_id = $1
         and not (company_id = any($2::text[]))
         and not exists (
           select 1 from public.enquiry_dispatches ed
           where ed.enquiry_vendor_id = enquiry_vendors.id
         )`,
      [itemId, validIds]
    );
    if (validIds.length) {
      await client.query(
        `insert into public.enquiry_vendors (enquiry_item_id, company_id, selected_by)
         select $1, unnest($2::text[]), $3
         on conflict (enquiry_item_id, company_id) do nothing`,
        [itemId, validIds, admin.id]
      );
    }
    await client.query("commit");
    return getVendorCandidates(itemId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function sendDispatches(
  enquiryVendorIds: string[],
  controlledAcknowledged: boolean,
  admin: AdminUser
) {
  const uniqueIds = [...new Set(enquiryVendorIds.filter(Boolean))];
  if (!uniqueIds.length) {
    throw new Error("Select at least one vendor.");
  }

  const sentBefore = await getPool().query<{ enquiry_vendor_id: string }>(
    `select distinct enquiry_vendor_id
     from public.enquiry_dispatches
     where enquiry_vendor_id = any($1::uuid[]) and status = 'sent'`,
    [uniqueIds]
  );
  const sentIds = new Set(sentBefore.rows.map((row) => row.enquiry_vendor_id));
  const pendingIds = uniqueIds.filter((id) => !sentIds.has(id));
  const results: Array<{ id: string; status: "sent" | "failed"; error?: string }> = [...sentIds].map(
    (id) => ({
      id,
      status: "failed",
      error: "This vendor has already received the enquiry."
    })
  );
  if (!pendingIds.length) {
    return { results, sent: 0, failed: results.length };
  }

  const source = await getPool().query(
    `select
       ev.id as enquiry_vendor_id,
       e.id as enquiry_id,
       e.customer_name,
       c.name as company_name,
       c.contact_email,
       coalesce(p.product_name, ei.raw_product_name) as product_name,
       coalesce(p.cas_number, ei.raw_cas_number) as cas_number,
       ei.remarks,
       cs.id is not null as is_controlled,
       coalesce(
         jsonb_agg(jsonb_build_object('quantity', eq.quantity, 'unit', eq.unit))
           filter (where eq.id is not null),
         '[]'::jsonb
       ) as quantities
     from public.enquiry_vendors ev
     join public.enquiry_items ei on ei.id = ev.enquiry_item_id
     join public.enquiries e on e.id = ei.enquiry_id
     join public.companies c on c.id = ev.company_id
     left join public.products p on p.id = ei.product_id
     left join public.controlled_substances cs
       on cs.is_active
      and cs.normalized_cas = lower(regexp_replace(btrim(coalesce(p.cas_number, ei.raw_cas_number)), '\\s+', '', 'g'))
     left join public.enquiry_quantities eq on eq.enquiry_item_id = ei.id
     where ev.id = any($1::uuid[])
     group by ev.id, e.id, c.id, ei.id, p.id, cs.id`,
    [pendingIds]
  );

  if (source.rows.some((row) => row.is_controlled) && !controlledAcknowledged) {
    throw new Error("Controlled-substance acknowledgement is required before sending.");
  }

  const transporter = createTransporter();
  for (const row of source.rows) {
    const recipients = parseEmails(row.contact_email);
    if (!recipients.length) {
      results.push({
        id: row.enquiry_vendor_id,
        status: "failed",
        error: "Vendor has no valid email address."
      });
      continue;
    }

    const quantities = Array.isArray(row.quantities) ? row.quantities : [];
    const subject = `Enquiry for ${row.product_name || "material"}${row.cas_number ? ` (CAS: ${row.cas_number})` : ""}`;
    const htmlBody = renderEnquiryEmail({
      companyName: row.company_name,
      productName: row.product_name,
      casNumber: row.cas_number,
      quantities,
      remarks: row.remarks
    });
    const attempt = await getPool().query<{ next_attempt: number }>(
      `select coalesce(max(attempt_number), 0) + 1 as next_attempt
       from public.enquiry_dispatches where enquiry_vendor_id = $1`,
      [row.enquiry_vendor_id]
    );
    const dispatch = await getPool().query<{ id: string }>(
      `insert into public.enquiry_dispatches (
         enquiry_vendor_id, recipient_emails, cc_emails, subject, html_body,
         status, attempt_number, controlled_acknowledged_by,
         controlled_acknowledged_at, created_by
       ) values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
       returning id`,
      [
        row.enquiry_vendor_id,
        recipients,
        DEFAULT_CC,
        subject,
        htmlBody,
        Number(attempt.rows[0]?.next_attempt ?? 1),
        row.is_controlled ? admin.id : null,
        row.is_controlled ? new Date() : null,
        admin.id
      ]
    );
    const dispatchId = dispatch.rows[0]!.id;

    try {
      const info = await transporter.sendMail({
        from: process.env.SENDER_EMAIL,
        to: recipients[0],
        cc: [...DEFAULT_CC, ...recipients.slice(1)],
        subject,
        html: htmlBody
      });
      await getPool().query(
        `update public.enquiry_dispatches
         set status = 'sent', sent_at = now(), provider_message_id = $2
         where id = $1`,
        [dispatchId, info.messageId]
      );
      results.push({ id: row.enquiry_vendor_id, status: "sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email delivery failed.";
      await getPool().query(
        `update public.enquiry_dispatches set status = 'failed', error_message = $2 where id = $1`,
        [dispatchId, message]
      );
      results.push({ id: row.enquiry_vendor_id, status: "failed", error: message });
    }
  }

  return {
    results,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length
  };
}

export async function listDispatches(options: { limit: number; offset: number; status?: string }) {
  const params: unknown[] = [];
  const where = options.status ? (params.push(options.status), `where ed.status = $${params.length}`) : "";
  const count = await getPool().query<{ count: string }>(
    `select count(*)::text as count from public.enquiry_dispatches ed ${where}`,
    params
  );
  params.push(options.limit, options.offset);
  const result = await getPool().query(
    `select
       ed.id,
       ed.status,
       ed.recipient_emails,
       ed.cc_emails,
       ed.subject,
       ed.error_message,
       ed.attempt_number,
       ed.created_at,
       ed.sent_at,
       c.name as company_name,
       e.id as enquiry_id,
       e.customer_name,
       coalesce(p.product_name, ei.raw_product_name) as product_name
     from public.enquiry_dispatches ed
     join public.enquiry_vendors ev on ev.id = ed.enquiry_vendor_id
     join public.companies c on c.id = ev.company_id
     join public.enquiry_items ei on ei.id = ev.enquiry_item_id
     join public.enquiries e on e.id = ei.enquiry_id
     left join public.products p on p.id = ei.product_id
     ${where}
     order by ed.created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return { records: result.rows, total: Number(count.rows[0]?.count ?? 0) };
}

export async function upsertQuote(enquiryVendorId: string, input: JsonRecord, admin: AdminUser) {
  const responseStatus = clean(input.responseStatus) || "awaiting";
  const outcome = clean(input.outcome) || "pending";
  if (!["awaiting", "quoted", "declined", "no_response"].includes(responseStatus)) {
    throw new Error("Invalid response status.");
  }
  if (!["pending", "shortlisted", "selected", "rejected"].includes(outcome)) {
    throw new Error("Invalid quote outcome.");
  }
  await getPool().query(
    `insert into public.vendor_quotes (
       enquiry_vendor_id, response_status, price, currency, lead_time_days,
       packing, hsn_code, notes, outcome, recorded_by, responded_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (enquiry_vendor_id) do update set
       response_status = excluded.response_status,
       price = excluded.price,
       currency = excluded.currency,
       lead_time_days = excluded.lead_time_days,
       packing = excluded.packing,
       hsn_code = excluded.hsn_code,
       notes = excluded.notes,
       outcome = excluded.outcome,
       recorded_by = excluded.recorded_by,
       responded_at = excluded.responded_at`,
    [
      enquiryVendorId,
      responseStatus,
      nullableNumber(input.price),
      clean(input.currency),
      nullableNumber(input.leadTimeDays),
      clean(input.packing),
      clean(input.hsnCode),
      clean(input.notes),
      outcome,
      admin.id,
      responseStatus === "awaiting" ? null : new Date()
    ]
  );
  return { success: true };
}

export async function getDashboardMetrics() {
  const summary = await getPool().query(
    `select
       count(*)::integer as total,
       count(*) filter (where resolution = 'open')::integer as open,
       count(*) filter (where workflow_stage = 'Sent')::integer as sent,
       count(*) filter (where workflow_stage = 'Responses Received')::integer as responses,
       count(*) filter (where resolution = 'won')::integer as won
     from public.enquiry_workflow`
  );
  const monthly = await getPool().query(
    `select to_char(date_trunc('month', received_at), 'Mon YYYY') as label, count(*)::integer as value
     from public.enquiries
     where received_at >= current_date - interval '11 months'
     group by date_trunc('month', received_at)
     order by date_trunc('month', received_at)`
  );
  const products = await getPool().query(
    `select coalesce(p.product_name, ei.raw_product_name, 'Unknown') as label, count(*)::integer as value
     from public.enquiry_items ei
     left join public.products p on p.id = ei.product_id
     group by 1
     order by value desc, label
     limit 8`
  );
  return { summary: summary.rows[0], monthly: monthly.rows, topProducts: products.rows };
}

async function insertEnquiry(client: PoolClient, input: EnquiryInput, adminId: string) {
  const enquiry = await client.query<{ id: string }>(
    `insert into public.enquiries (
       external_reference, customer_name, customer_email, customer_company,
       enquiry_type, received_at, notes, created_by
     ) values ($1,$2,$3,$4,$5,coalesce($6::date,current_date),$7,$8)
     returning id`,
    [
      clean(input.externalReference),
      input.customerName.trim(),
      clean(input.customerEmail),
      clean(input.customerCompany),
      clean(input.enquiryType) || "sourcing",
      clean(input.receivedAt),
      clean(input.notes),
      adminId
    ]
  );
  const enquiryId = enquiry.rows[0]!.id;

  for (const item of input.items) {
    const product = await resolveProduct(client, item);
    const itemResult = await client.query<{ id: string }>(
      `insert into public.enquiry_items (
         enquiry_id, product_id, raw_product_name, raw_cas_number, remarks
       ) values ($1,$2,$3,$4,$5) returning id`,
      [
        enquiryId,
        product?.id ?? null,
        product ? null : clean(item.productName),
        product ? null : clean(item.casNumber),
        clean(item.remarks)
      ]
    );
    const itemId = itemResult.rows[0]!.id;
    for (const quantity of item.quantities ?? []) {
      if (!(Number(quantity.quantity) > 0) || !clean(quantity.unit)) continue;
      await client.query(
        `insert into public.enquiry_quantities (enquiry_item_id, quantity, unit)
         values ($1,$2,$3)`,
        [itemId, Number(quantity.quantity), clean(quantity.unit)]
      );
    }
  }
  return enquiryId;
}

async function resolveProduct(client: PoolClient, item: ItemInput) {
  if (item.productId) {
    const result = await client.query(`select id from public.products where id = $1 and deleted_at is null`, [
      item.productId
    ]);
    if (result.rows[0]) return result.rows[0];
  }
  const cas = normalizeCas(item.casNumber);
  if (cas) {
    const result = await client.query(
      `select id from public.products
       where deleted_at is null
         and lower(regexp_replace(btrim(cas_number), '\\s+', '', 'g')) = $1
       limit 1`,
      [cas]
    );
    if (result.rows[0]) return result.rows[0];
  }
  const name = clean(item.productName);
  if (name) {
    const result = await client.query(
      `select id from public.products
       where deleted_at is null and lower(btrim(product_name)) = lower($1)
       limit 1`,
      [name]
    );
    if (result.rows[0]) return result.rows[0];
  }
  return null;
}

function createTransporter() {
  const port = Number(process.env.SMTP_PORT ?? 587);
  if (!process.env.SENDER_EMAIL || !process.env.SENDER_PASSWORD || !process.env.SMTP_SERVER) {
    throw new Error("SMTP settings are incomplete.");
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_SERVER,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SENDER_EMAIL,
      pass: process.env.SENDER_PASSWORD
    }
  });
}

function renderEnquiryEmail(input: {
  companyName: string;
  productName: string | null;
  casNumber: string | null;
  quantities: Array<{ quantity?: unknown; unit?: unknown }>;
  remarks: string | null;
}) {
  const quantities = input.quantities
    .map((quantity) => `${html(String(quantity.quantity ?? ""))} ${html(String(quantity.unit ?? ""))}`.trim())
    .filter(Boolean)
    .join(", ");
  return `<!doctype html>
  <html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#17222b">
    <p>Dear ${html(input.companyName || "Sir/Madam")},</p>
    <p><strong>Greetings from Covenants PharmaChem!</strong></p>
    <p>We are looking for the following material and request your best offer with lead time, COA/specification, packing size and HSN code.</p>
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:640px">
      <tr><td style="border:1px solid #d7dfdc"><strong>Product</strong></td><td style="border:1px solid #d7dfdc">${html(input.productName || "N/A")}</td></tr>
      <tr><td style="border:1px solid #d7dfdc"><strong>CAS Number</strong></td><td style="border:1px solid #d7dfdc">${html(input.casNumber || "N/A")}</td></tr>
      <tr><td style="border:1px solid #d7dfdc"><strong>Quantity</strong></td><td style="border:1px solid #d7dfdc">${quantities || "N/A"}</td></tr>
      ${input.remarks ? `<tr><td style="border:1px solid #d7dfdc"><strong>Remarks</strong></td><td style="border:1px solid #d7dfdc">${html(input.remarks)}</td></tr>` : ""}
    </table>
    <p>Best regards,<br>Sourcing Team<br><strong>Covenants PharmaChem LLP</strong></p>
  </body></html>`;
}

function validateEnquiryInput(input: EnquiryInput) {
  if (!input.customerName?.trim()) throw new Error("Customer name is required.");
  if (!Array.isArray(input.items) || input.items.length === 0)
    throw new Error("At least one enquiry item is required.");
  for (const item of input.items) {
    if (!item.productId && !clean(item.productName) && !clean(item.casNumber)) {
      throw new Error("Each enquiry item needs a product, product name, or CAS number.");
    }
  }
}

function parseEmails(value: unknown) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[;,]/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
  ];
}

function normalizeCas(value: unknown) {
  return clean(value)?.replace(/\s+/g, "").toLowerCase() ?? null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function html(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
