import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDollarSign, Mail, Plus, Search, Send, Trash2, Upload, X } from "lucide-react";

type RecordValue = Record<string, any>;

interface EnquiryListResponse {
  records: RecordValue[];
  total: number;
}

interface EnquiryDraftItem {
  productId: string;
  productName: string;
  casNumber: string;
  quantity: string;
  unit: string;
  remarks: string;
  additionalQuantities: Array<{ quantity: string; unit: string }>;
}

const EMPTY_ITEM: EnquiryDraftItem = {
  productId: "",
  productName: "",
  casNumber: "",
  quantity: "",
  unit: "kg",
  remarks: "",
  additionalQuantities: []
};

export function OverviewWorkspace({ onOpenEnquiries }: { onOpenEnquiries: () => void }) {
  const [data, setData] = useState<RecordValue | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void workflowApi<RecordValue>("/api/dashboard").then(setData).catch((value) => setError(message(value)));
  }, []);

  const summary = data?.summary ?? {};

  return (
    <div className="workflow-page">
      <header className="workflow-hero">
        <div>
          <p className="eyebrow">Command center</p>
          <h2>Sourcing overview</h2>
          <p>Live enquiry activity, vendor outreach and responses—all derived from Supabase.</p>
        </div>
        <button className="primary-button" onClick={onOpenEnquiries} type="button">
          <Plus size={16} /> New enquiry
        </button>
      </header>

      {error ? <p className="banner error">{error}</p> : null}
      <section className="metric-grid">
        {[
          ["Total enquiries", summary.total ?? "—"],
          ["Open", summary.open ?? "—"],
          ["Sent", summary.sent ?? "—"],
          ["Responses", summary.responses ?? "—"],
          ["Won", summary.won ?? "—"]
        ].map(([label, value]) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel analytics-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Volume</p>
              <h3>Enquiries by month</h3>
            </div>
          </div>
          <SimpleBars rows={data?.monthly ?? []} />
        </article>
        <article className="panel analytics-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Demand</p>
              <h3>Top requested products</h3>
            </div>
          </div>
          <SimpleBars rows={data?.topProducts ?? []} />
        </article>
      </section>
    </div>
  );
}

export function EnquiriesWorkspace() {
  const [records, setRecords] = useState<RecordValue[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<RecordValue | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  async function loadRecords(signal?: AbortSignal) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (search.trim()) params.set("search", search.trim());
      if (stage) params.set("stage", stage);
      const data = await workflowApi<EnquiryListResponse>(`/api/enquiries?${params}`, { signal });
      setRecords(data.records);
      setTotal(data.total);
      setError("");
    } catch (value) {
      if (!signal?.aborted) setError(message(value));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadRecords(controller.signal), 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, stage]);

  async function openDetail(id: string) {
    setSelectedId(id);
    setDetail(null);
    try {
      setDetail(await workflowApi<RecordValue>(`/api/enquiries/${id}`));
    } catch (value) {
      setError(message(value));
    }
  }

  async function refreshAfterMutation(id?: string) {
    await loadRecords();
    if (id || selectedId) await openDetail(id || selectedId);
  }

  return (
    <div className="workflow-page">
      <header className="workflow-hero compact">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2>Enquiries</h2>
          <p>{total} enquiries · source, select vendors, dispatch and compare responses in one place.</p>
        </div>
        <div className="workflow-actions">
          <button className="ghost-button" onClick={() => setImportOpen(true)} type="button">
            <Upload size={16} /> Import
          </button>
          <button className="primary-button" onClick={() => setCreateOpen(true)} type="button">
            <Plus size={16} /> New enquiry
          </button>
        </div>
      </header>

      <section className="panel workflow-toolbar">
        <label className="workflow-search">
          <Search size={16} />
          <input
            aria-label="Search enquiries"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Customer, reference, product or CAS…"
            type="search"
            value={search}
          />
        </label>
        <select aria-label="Filter by stage" onChange={(event) => setStage(event.target.value)} value={stage}>
          <option value="">All stages</option>
          <option value="New">New</option>
          <option value="Sourcing">Sourcing</option>
          <option value="Sent">Sent</option>
          <option value="Responses Received">Responses received</option>
          <option value="Won">Won</option>
          <option value="Lost">Lost</option>
          <option value="Cancelled">Cancelled</option>
        </select>
      </section>

      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner success">{notice}</p> : null}

      <section className="enquiry-layout">
        <div className="panel enquiry-list" aria-busy={loading}>
          {loading ? (
            <div className="skeleton-stack">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>
          ) : records.length ? (
            records.map((record) => (
              <button
                className={selectedId === record.id ? "enquiry-list-row active" : "enquiry-list-row"}
                key={record.id}
                onClick={() => void openDetail(record.id)}
                type="button"
              >
                <div>
                  <strong>{record.customer_name}</strong>
                  <span>{record.customer_company || record.external_reference || "Direct enquiry"}</span>
                </div>
                <div className="enquiry-row-meta">
                  <StagePill stage={record.workflow_stage} />
                  <span>{formatDate(record.received_at)}</span>
                  <small>{record.item_count} item{record.item_count === 1 ? "" : "s"}</small>
                </div>
                <ChevronRight size={16} />
              </button>
            ))
          ) : (
            <div className="empty-state">No enquiries match these filters.</div>
          )}
        </div>

        <div className="panel enquiry-detail">
          {selectedId && !detail ? (
            <div className="skeleton-stack">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
          ) : detail ? (
            <EnquiryDetail
              detail={detail}
              onRefresh={() => void refreshAfterMutation()}
              onNotice={setNotice}
              onError={setError}
            />
          ) : (
            <div className="detail-placeholder">
              <Mail size={28} />
              <h3>Select an enquiry</h3>
              <p>Open an enquiry to source vendors, send requests and record quotes.</p>
            </div>
          )}
        </div>
      </section>

      {createOpen ? (
        <CreateEnquiryDialog
          onClose={() => setCreateOpen(false)}
          onCreated={async (id) => {
            setCreateOpen(false);
            setNotice("Enquiry created.");
            await refreshAfterMutation(id);
          }}
        />
      ) : null}
      {importOpen ? (
        <ImportEnquiriesDialog
          onClose={() => setImportOpen(false)}
          onImported={async (count) => {
            setImportOpen(false);
            setNotice(`Imported ${count} enquiries.`);
            await loadRecords();
          }}
        />
      ) : null}
    </div>
  );
}

export function DispatchHistoryWorkspace() {
  const [records, setRecords] = useState<RecordValue[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100", offset: "0" });
    if (status) params.set("status", status);
    void workflowApi<EnquiryListResponse>(`/api/enquiry-dispatches?${params}`)
      .then((data) => {
        setRecords(data.records);
        setError("");
      })
      .catch((value) => setError(message(value)))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="workflow-page">
      <header className="workflow-hero compact">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h2>Dispatch history</h2>
          <p>Every SMTP attempt, recipient and delivery result is retained in Supabase.</p>
        </div>
        <select onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </header>
      {error ? <p className="banner error">{error}</p> : null}
      <section className="panel">
        <div className="table-scroller">
          <table>
            <thead>
              <tr><th>Status</th><th>Vendor</th><th>Product</th><th>Recipients</th><th>Attempt</th><th>Created</th><th>Result</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}><div className="empty-state">Loading dispatches…</div></td></tr>
              ) : records.map((record) => (
                <tr key={record.id}>
                  <td><StagePill stage={record.status} /></td>
                  <td>{record.company_name}</td>
                  <td>{record.product_name}</td>
                  <td>{record.recipient_emails?.join(", ")}</td>
                  <td>#{record.attempt_number}</td>
                  <td>{formatDateTime(record.created_at)}</td>
                  <td className={record.status === "failed" ? "danger-text" : ""}>
                    {record.error_message || (record.sent_at ? `Sent ${formatDateTime(record.sent_at)}` : "Pending")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EnquiryDetail({
  detail,
  onRefresh,
  onNotice,
  onError
}: {
  detail: RecordValue;
  onRefresh: () => void;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
}) {
  const [activeItemId, setActiveItemId] = useState(detail.items?.[0]?.id ?? "");
  const [candidates, setCandidates] = useState<RecordValue[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const activeItem = detail.items?.find((item: RecordValue) => item.id === activeItemId) ?? detail.items?.[0];
  const selectedVendors = detail.vendors?.filter((vendor: RecordValue) => vendor.enquiry_item_id === activeItem?.id) ?? [];

  useEffect(() => {
    if (!activeItem?.id || !activeItem.product_id) {
      setCandidates([]);
      return;
    }
    setCandidateLoading(true);
    void workflowApi<{ records: RecordValue[] }>(`/api/enquiry-items/${activeItem.id}/vendors`)
      .then((data) => setCandidates(data.records))
      .catch((value) => onError(message(value)))
      .finally(() => setCandidateLoading(false));
  }, [activeItem?.id]);

  async function toggleVendor(companyId: string) {
    const selected = new Set(candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.company_id));
    selected.has(companyId) ? selected.delete(companyId) : selected.add(companyId);
    try {
      const data = await workflowApi<{ records: RecordValue[] }>(`/api/enquiry-items/${activeItem.id}/vendors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds: [...selected] })
      });
      setCandidates(data.records);
      onRefresh();
    } catch (value) {
      onError(message(value));
    }
  }

  async function sendSelected() {
    const alreadySentIds = new Set(
      selectedVendors
        .filter((vendor: RecordValue) => vendor.dispatch_status === "sent")
        .map((vendor: RecordValue) => vendor.id)
    );
    const vendorIds = candidates
      .filter((candidate) => candidate.selected && candidate.enquiry_vendor_id)
      .map((candidate) => candidate.enquiry_vendor_id)
      .filter((id) => !alreadySentIds.has(id));
    if (!vendorIds.length) {
      onError("All selected vendors have already been sent this enquiry.");
      return;
    }
    setSending(true);
    try {
      const result = await workflowApi<{ sent: number; failed: number }>("/api/enquiry-dispatches/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enquiryVendorIds: vendorIds, controlledAcknowledged: acknowledged })
      });
      onNotice(`${result.sent} sent${result.failed ? ` · ${result.failed} failed` : ""}.`);
      onRefresh();
    } catch (value) {
      onError(message(value));
    } finally {
      setSending(false);
    }
  }

  async function updateResolution(resolution: string) {
    try {
      await workflowApi(`/api/enquiries/${detail.id}/resolution`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution })
      });
      onNotice(`Enquiry marked ${resolution}.`);
      onRefresh();
    } catch (value) {
      onError(message(value));
    }
  }

  return (
    <div>
      <div className="detail-head">
        <div>
          <div className="detail-title-line">
            <StagePill stage={detail.workflow_stage} />
            <span>{formatDate(detail.received_at)}</span>
          </div>
          <h3>{detail.customer_name}</h3>
          <p>{[detail.customer_company, detail.customer_email, detail.external_reference].filter(Boolean).join(" · ")}</p>
        </div>
        <select aria-label="Resolution" onChange={(event) => void updateResolution(event.target.value)} value={detail.resolution}>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="item-tabs">
        {detail.items?.map((item: RecordValue, index: number) => (
          <button
            className={item.id === activeItem?.id ? "active" : ""}
            key={item.id}
            onClick={() => {
              setActiveItemId(item.id);
              setAcknowledged(false);
            }}
            type="button"
          >
            <span>{index + 1}</span>{item.product_name || item.cas_number}
          </button>
        ))}
      </div>

      {activeItem ? (
        <>
          <section className="item-summary">
            <div><span>Product</span><strong>{activeItem.product_name || "Unmatched material"}</strong></div>
            <div><span>CAS</span><strong>{activeItem.cas_number || "—"}</strong></div>
            <div><span>Quantity</span><strong>{activeItem.quantities?.map((q: RecordValue) => `${q.quantity} ${q.unit}`).join(", ") || "—"}</strong></div>
          </section>

          {activeItem.is_controlled ? (
            <div className="controlled-card">
              <AlertTriangle size={20} />
              <div>
                <strong>Controlled substance</strong>
                <p>{activeItem.controlled_reason || "This CAS is listed as controlled."}</p>
                {activeItem.scomet_entry ? <small>SCOMET: {activeItem.scomet_entry}</small> : null}
              </div>
            </div>
          ) : null}

          <div className="section-heading">
            <div><p className="eyebrow">Supabase-derived network</p><h4>Vendor candidates</h4></div>
            <span>{candidates.length} available</span>
          </div>
          <div className="candidate-list">
            {candidateLoading ? <p className="helper-note">Finding active facilities…</p> : null}
            {!candidateLoading && !activeItem.product_id ? (
              <p className="helper-note">Match this item to a catalog product before sourcing vendors.</p>
            ) : null}
            {candidates.map((candidate) => (
              <button
                className={candidate.selected ? "candidate-row selected" : "candidate-row"}
                key={candidate.company_id}
                onClick={() => void toggleVendor(candidate.company_id)}
                type="button"
              >
                <span className="candidate-check">{candidate.selected ? <Check size={14} /> : null}</span>
                <span><strong>{candidate.company_name}</strong><small>{candidate.contact_email}</small></span>
                <span>{candidate.facility_count} facilit{candidate.facility_count === 1 ? "y" : "ies"}</span>
              </button>
            ))}
          </div>

          {selectedVendors.length ? (
            <div className="sticky-action-bar">
              <div>
                <strong>{selectedVendors.length} vendor{selectedVendors.length === 1 ? "" : "s"} selected</strong>
                <span>{selectedVendors.filter((vendor: RecordValue) => vendor.dispatch_status === "sent").length} already sent</span>
              </div>
              {activeItem.is_controlled ? (
                <label className="acknowledgement">
                  <input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />
                  I acknowledge the controlled-substance warning
                </label>
              ) : null}
              <button
                className="primary-button"
                disabled={sending || (activeItem.is_controlled && !acknowledged)}
                onClick={() => void sendSelected()}
                type="button"
              >
                <Send size={15} /> {sending ? "Sending…" : "Send enquiries"}
              </button>
            </div>
          ) : null}

          {selectedVendors.length ? (
            <div className="quote-list">
              <div className="section-heading"><div><p className="eyebrow">Responses</p><h4>Vendor quotes</h4></div></div>
              {selectedVendors.map((vendor: RecordValue) => (
                <QuoteRow key={vendor.id} vendor={vendor} onError={onError} onSaved={onRefresh} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function QuoteRow({ vendor, onSaved, onError }: { vendor: RecordValue; onSaved: () => void; onError: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    responseStatus: vendor.response_status || "awaiting",
    price: vendor.price || "",
    currency: vendor.currency || "INR",
    leadTimeDays: vendor.lead_time_days || "",
    packing: vendor.packing || "",
    hsnCode: vendor.hsn_code || "",
    notes: vendor.quote_notes || "",
    outcome: vendor.outcome || "pending"
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await workflowApi(`/api/enquiry-vendors/${vendor.id}/quote`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      setEditing(false);
      onSaved();
    } catch (value) {
      onError(message(value));
    }
  }

  return (
    <article className="quote-row">
      <div>
        <strong>{vendor.company_name}</strong>
        <span>{vendor.dispatch_status ? `Dispatch: ${vendor.dispatch_status}` : "Not sent"}</span>
      </div>
      <div>
        <StagePill stage={vendor.response_status || "awaiting"} />
        {vendor.price ? <strong>{vendor.currency || ""} {vendor.price}</strong> : null}
        {vendor.lead_time_days !== null && vendor.lead_time_days !== undefined ? <span>{vendor.lead_time_days} days</span> : null}
      </div>
      <button className="ghost-button" onClick={() => setEditing(true)} type="button">
        <CircleDollarSign size={15} /> Record quote
      </button>
      {editing ? (
        <div className="overlay">
          <form className="dialog quote-dialog" onSubmit={save}>
            <div className="dialog-head"><div><p className="eyebrow">Vendor response</p><h3>{vendor.company_name}</h3></div><button className="close-button" onClick={() => setEditing(false)} type="button"><X size={18} /></button></div>
            <div className="form-grid">
              <Field label="Response"><select value={form.responseStatus} onChange={(e) => setForm({ ...form, responseStatus: e.target.value })}><option value="awaiting">Awaiting</option><option value="quoted">Quoted</option><option value="declined">Declined</option><option value="no_response">No response</option></select></Field>
              <Field label="Outcome"><select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}><option value="pending">Pending</option><option value="shortlisted">Shortlisted</option><option value="selected">Selected</option><option value="rejected">Rejected</option></select></Field>
              <Field label="Price"><input min="0" step="any" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
              <Field label="Currency"><input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></Field>
              <Field label="Lead time (days)"><input min="0" type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} /></Field>
              <Field label="Packing"><input value={form.packing} onChange={(e) => setForm({ ...form, packing: e.target.value })} /></Field>
              <Field label="HSN code"><input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} /></Field>
              <Field label="Notes"><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <div className="dialog-actions dialog-footer"><button className="ghost-button" onClick={() => setEditing(false)} type="button">Cancel</button><button className="primary-button" type="submit">Save response</button></div>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function CreateEnquiryDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [header, setHeader] = useState({ customerName: "", customerEmail: "", customerCompany: "", externalReference: "", enquiryType: "sourcing", receivedAt: new Date().toISOString().slice(0, 10), notes: "" });
  const [items, setItems] = useState<EnquiryDraftItem[]>([{ ...EMPTY_ITEM }]);
  const [results, setResults] = useState<Record<number, RecordValue[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateItem(index: number, patch: Partial<EnquiryDraftItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function searchProduct(index: number, value: string) {
    updateItem(index, { productName: value, productId: "" });
    if (value.trim().length < 2) return setResults((current) => ({ ...current, [index]: [] }));
    try {
      const data = await workflowApi<{ records: RecordValue[] }>(`/api/enquiry-products?search=${encodeURIComponent(value)}`);
      setResults((current) => ({ ...current, [index]: data.records }));
    } catch (value) {
      setError(message(value));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await workflowApi<RecordValue>("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...header,
          items: items.map((item) => ({
            productId: item.productId || null,
            productName: item.productName || null,
            casNumber: item.casNumber || null,
            remarks: item.remarks || null,
            quantities: [
              ...(Number(item.quantity) > 0 ? [{ quantity: Number(item.quantity), unit: item.unit }] : []),
              ...item.additionalQuantities
                .filter((quantity) => Number(quantity.quantity) > 0)
                .map((quantity) => ({ quantity: Number(quantity.quantity), unit: quantity.unit }))
            ]
          }))
        })
      });
      onCreated(created.id);
    } catch (value) {
      setError(message(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="enquiry-dialog-overlay" />
        <Dialog.Content asChild>
          <form className="enquiry-dialog-content" onSubmit={submit}>
            <header className="enquiry-dialog-header">
              <div className="enquiry-dialog-title-icon"><Plus size={20} /></div>
              <div>
                <p className="eyebrow">New workflow</p>
                <Dialog.Title>Create enquiry</Dialog.Title>
                <Dialog.Description>
                  Add the customer details, then list each requested material.
                </Dialog.Description>
              </div>
              <Dialog.Close className="enquiry-dialog-close" aria-label="Close" type="button">
                <X size={18} />
              </Dialog.Close>
            </header>

            <div className="enquiry-dialog-body">
              {error ? <p className="banner error">{error}</p> : null}

              <section className="enquiry-form-section">
                <div className="enquiry-section-heading">
                  <div>
                    <span>01</span>
                    <div>
                      <h4>Customer details</h4>
                      <p>Contact and reference information for this enquiry.</p>
                    </div>
                  </div>
                </div>
                <div className="enquiry-customer-grid">
                  <Field label="Customer name"><input required value={header.customerName} onChange={(e) => setHeader({ ...header, customerName: e.target.value })} /></Field>
                  <Field label="Customer company"><input value={header.customerCompany} onChange={(e) => setHeader({ ...header, customerCompany: e.target.value })} /></Field>
                  <Field label="Customer email"><input type="email" value={header.customerEmail} onChange={(e) => setHeader({ ...header, customerEmail: e.target.value })} /></Field>
                  <Field label="External reference"><input value={header.externalReference} onChange={(e) => setHeader({ ...header, externalReference: e.target.value })} /></Field>
                  <Field label="Received date"><input required type="date" value={header.receivedAt} onChange={(e) => setHeader({ ...header, receivedAt: e.target.value })} /></Field>
                  <Field label="Enquiry type"><input value={header.enquiryType} onChange={(e) => setHeader({ ...header, enquiryType: e.target.value })} /></Field>
                  <div className="enquiry-notes-field">
                    <Field label="Notes"><textarea rows={3} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} /></Field>
                  </div>
                </div>
              </section>

              <section className="enquiry-form-section">
                <div className="enquiry-section-heading">
                  <div>
                    <span>02</span>
                    <div>
                      <h4>Requested materials</h4>
                      <p>{items.length} item{items.length === 1 ? "" : "s"} in this enquiry.</p>
                    </div>
                  </div>
                  <button className="ghost-button" onClick={() => setItems([...items, { ...EMPTY_ITEM }])} type="button">
                    <Plus size={15} /> Add item
                  </button>
                </div>

                <div className="draft-item-list">
                  {items.map((item, index) => (
                    <section className="draft-item" key={index}>
                      <div className="draft-item-heading">
                        <span className="draft-item-number">{index + 1}</span>
                        <strong>Material {index + 1}</strong>
                        {items.length > 1 ? (
                          <button
                            aria-label={`Remove item ${index + 1}`}
                            className="remove-item"
                            onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}
                            type="button"
                          >
                            <Trash2 size={14} />
                            <span>Remove</span>
                          </button>
                        ) : null}
                      </div>
                      <div className="draft-item-fields">
                        <div className="draft-product-field">
                          <Field label="Product or material">
                            <div className="product-autocomplete">
                              <input required={!item.casNumber} value={item.productName} onChange={(e) => void searchProduct(index, e.target.value)} placeholder="Search product catalog…" />
                              {results[index]?.length ? <div className="autocomplete-results">{results[index].map((product) => <button key={product.id} onClick={() => { updateItem(index, { productId: product.id, productName: product.product_name, casNumber: product.cas_number || "" }); setResults((current) => ({ ...current, [index]: [] })); }} type="button"><strong>{product.product_name}</strong><span>{product.cas_number || "No CAS"}{product.is_controlled ? " · Controlled" : ""}</span></button>)}</div> : null}
                            </div>
                          </Field>
                        </div>
                        <Field label="CAS number"><input value={item.casNumber} onChange={(e) => updateItem(index, { casNumber: e.target.value, productId: "" })} /></Field>
                        <Field label="Quantity"><input min="0" step="any" type="number" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} /></Field>
                        <Field label="Unit"><select value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })}><option value="g">g</option><option value="kg">kg</option><option value="MT">MT</option><option value="L">L</option><option value="KL">KL</option></select></Field>
                        <div className="draft-remarks-field">
                          <Field label="Remarks"><input value={item.remarks} onChange={(e) => updateItem(index, { remarks: e.target.value })} /></Field>
                        </div>
                        <div className="additional-quantities">
                          {item.additionalQuantities.map((quantity, quantityIndex) => (
                            <div className="additional-quantity" key={quantityIndex}>
                              <input
                                aria-label={`Additional quantity ${quantityIndex + 1}`}
                                min="0"
                                placeholder="Quantity"
                                step="any"
                                type="number"
                                value={quantity.quantity}
                                onChange={(event) =>
                                  updateItem(index, {
                                    additionalQuantities: item.additionalQuantities.map((entry, entryIndex) =>
                                      entryIndex === quantityIndex ? { ...entry, quantity: event.target.value } : entry
                                    )
                                  })
                                }
                              />
                              <select
                                aria-label={`Additional unit ${quantityIndex + 1}`}
                                value={quantity.unit}
                                onChange={(event) =>
                                  updateItem(index, {
                                    additionalQuantities: item.additionalQuantities.map((entry, entryIndex) =>
                                      entryIndex === quantityIndex ? { ...entry, unit: event.target.value } : entry
                                    )
                                  })
                                }
                              >
                                <option value="g">g</option><option value="kg">kg</option><option value="MT">MT</option><option value="L">L</option><option value="KL">KL</option>
                              </select>
                              <button
                                aria-label={`Remove additional quantity ${quantityIndex + 1}`}
                                onClick={() =>
                                  updateItem(index, {
                                    additionalQuantities: item.additionalQuantities.filter((_, entryIndex) => entryIndex !== quantityIndex)
                                  })
                                }
                                type="button"
                              ><X size={14} /></button>
                            </div>
                          ))}
                          <button
                            className="add-quantity-button"
                            onClick={() =>
                              updateItem(index, {
                                additionalQuantities: [...item.additionalQuantities, { quantity: "", unit: "kg" }]
                              })
                            }
                            type="button"
                          ><Plus size={14} /> Add another quantity</button>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </div>

            <footer className="enquiry-dialog-footer">
              <button className="ghost-button" onClick={onClose} type="button">Cancel</button>
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? "Creating…" : "Create enquiry"}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ImportEnquiriesDialog({ onClose, onImported }: { onClose: () => void; onImported: (count: number) => void }) {
  const [rows, setRows] = useState<RecordValue[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function readFile(file: File | null) {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      const raw = XLSX.utils.sheet_to_json<RecordValue>(sheet, { defval: "", raw: false });
      const normalized = raw.map((row) => {
        const byKey = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"), value]));
        return {
          externalReference: byKey.external_reference || byKey.reference,
          customerName: byKey.customer_name || byKey.customer,
          customerEmail: byKey.customer_email || byKey.email,
          customerCompany: byKey.customer_company || byKey.company,
          enquiryType: byKey.enquiry_type || byKey.type,
          receivedAt: byKey.received_at || byKey.received_date || byKey.date,
          productName: byKey.product_name || byKey.product || byKey.material_name,
          casNumber: byKey.cas_number || byKey.cas_no || byKey.cas,
          quantity: byKey.quantity || byKey.qty,
          unit: byKey.unit || byKey.uom,
          remarks: byKey.remarks || byKey.notes
        };
      });
      setRows(normalized);
      setFileName(file.name);
      setError("");
    } catch (value) {
      setError(`Could not read workbook: ${message(value)}`);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const result = await workflowApi<{ created: number }>("/api/enquiries/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      });
      onImported(result.created);
    } catch (value) {
      setError(message(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay">
      <section className="dialog import-dialog">
        <div className="dialog-head"><div><p className="eyebrow">Supabase import</p><h3>Import enquiries</h3><p className="dialog-copy">Rows with the same external reference become one multi-product enquiry.</p></div><button className="close-button" onClick={onClose} type="button"><X size={18} /></button></div>
        {error ? <p className="banner error">{error}</p> : null}
        <label className="upload-zone"><input accept=".xlsx,.xls" onChange={(event) => void readFile(event.target.files?.[0] ?? null)} type="file" /><Upload size={24} /><strong>{fileName || "Choose Excel file"}</strong><span>Expected: customer, date, product/CAS, quantity and UOM. External reference is optional.</span></label>
        {rows.length ? <div className="import-preview"><strong>{rows.length} rows ready</strong><span>{new Set(rows.map((row) => row.externalReference || crypto.randomUUID())).size} enquiry groups</span></div> : null}
        <div className="dialog-actions dialog-footer"><button className="ghost-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" disabled={!rows.length || busy} onClick={() => void submit()} type="button">{busy ? "Importing…" : `Import ${rows.length || ""} rows`}</button></div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function StagePill({ stage }: { stage: string }) {
  const key = String(stage || "").toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
  return <span className={`stage-pill stage-${key}`}>{stage || "Unknown"}</span>;
}

function SimpleBars({ rows }: { rows: RecordValue[] }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return rows.length ? (
    <div className="simple-bars">
      {rows.map((row) => <div className="simple-bar" key={row.label}><span>{row.label}</span><div><i style={{ width: `${Math.max(5, (Number(row.value) / max) * 100)}%` }} /></div><strong>{row.value}</strong></div>)}
    </div>
  ) : <div className="empty-state">No enquiry data yet.</div>;
}

async function workflowApi<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = await window.Clerk?.session?.getToken();
  if (!token) throw new Error("You must be signed in to continue.");
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error ?? "Request failed.");
  return data as T;
}

function message(value: unknown) {
  return value instanceof Error ? value.message : "Something went wrong.";
}

function formatDate(value: unknown) {
  const date = parseDateValue(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value: unknown) {
  const date = parseDateValue(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function parseDateValue(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00`)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
