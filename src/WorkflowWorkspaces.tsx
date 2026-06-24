import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDollarSign,
  Mail,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { ApiRecord, VendorCandidatesResponse } from "../shared/types";
import { apiRequest as workflowApi } from "./lib/api";
import { formatDate, formatDateTime } from "./lib/dates";
import { getErrorMessage as message } from "./lib/errors";
import {
  useDashboardQuery,
  useDispatchesQuery,
  useEnquiriesQuery,
  useEnquiryQuery,
  useVendorCandidatesQuery,
  workflowQueryKeys
} from "./features/workflow/hooks";
import { StatusBanner } from "./components/StatusBanner";
import { Field } from "./components/Field";

type RecordValue = ApiRecord;

interface EnquiryDraftItem {
  productId: string;
  productCode: string;
  productName: string;
  casNumber: string;
  quantity: string;
  unit: string;
  remarks: string;
  additionalQuantities: Array<{ quantity: string; unit: string }>;
}

const EMPTY_ITEM: EnquiryDraftItem = {
  productId: "",
  productCode: "",
  productName: "",
  casNumber: "",
  quantity: "",
  unit: "kg",
  remarks: "",
  additionalQuantities: []
};

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function parseContactEmails(value: unknown) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[;,]/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
  ];
}

export function OverviewWorkspace({ onOpenEnquiries }: { onOpenEnquiries: () => void }) {
  const { data, error } = useDashboardQuery();

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

      <StatusBanner variant="error">{error ? message(error) : ""}</StatusBanner>
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const debouncedSearch = useDebouncedValue(search, 220);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const enquiriesQuery = useEnquiriesQuery(debouncedSearch, stage);
  const detailQuery = useEnquiryQuery(selectedId);
  const records = enquiriesQuery.data?.records ?? [];
  const total = enquiriesQuery.data?.total ?? 0;
  const detail = detailQuery.data ?? null;
  const loading = enquiriesQuery.isLoading;
  const error = localError || (enquiriesQuery.error ? message(enquiriesQuery.error) : detailQuery.error ? message(detailQuery.error) : "");

  async function refreshListAndDetail(id?: string) {
    const detailId = id || selectedId;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workflow", "enquiries"] }),
      detailId ? queryClient.invalidateQueries({ queryKey: workflowQueryKeys.enquiry(detailId) }) : Promise.resolve()
    ]);
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

      <StatusBanner variant="error">{error}</StatusBanner>
      <StatusBanner variant="success">{notice}</StatusBanner>

      <section className="enquiry-layout">
        <div className="panel enquiry-list" aria-busy={loading}>
          {loading ? (
            <div className="skeleton-stack">
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
          ) : records.length ? (
            records.map((record) => (
              <button
                className={selectedId === record.id ? "enquiry-list-row active" : "enquiry-list-row"}
                key={record.id}
                onClick={() => {
                  setLocalError("");
                  setSelectedId(record.id);
                }}
                type="button"
              >
                <div>
                  <strong>{record.customer_name}</strong>
                  <span>{record.customer_company || record.external_reference || "Direct enquiry"}</span>
                </div>
                <div className="enquiry-row-meta">
                  <StagePill stage={record.workflow_stage} />
                  <span>{formatDate(record.received_at)}</span>
                  <small>
                    {record.item_count} item{record.item_count === 1 ? "" : "s"}
                  </small>
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
            <div className="skeleton-stack">
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
          ) : detail ? (
            <EnquiryDetail
              detail={detail}
              onNotice={setNotice}
              onError={setLocalError}
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
            setSelectedId(id);
            await refreshListAndDetail(id);
          }}
        />
      ) : null}
      {importOpen ? (
        <ImportEnquiriesDialog
          onClose={() => setImportOpen(false)}
          onImported={async (count) => {
            setImportOpen(false);
            setNotice(`Imported ${count} enquiries.`);
            await queryClient.invalidateQueries({ queryKey: ["workflow", "enquiries"] });
          }}
        />
      ) : null}
    </div>
  );
}

export function DispatchHistoryWorkspace() {
  const [status, setStatus] = useState("");
  const { data, error, isLoading } = useDispatchesQuery(status);
  const records = data?.records ?? [];

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
      <StatusBanner variant="error">{error ? message(error) : ""}</StatusBanner>
      <section className="panel">
        <div className="table-scroller dispatch-table-scroller">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Vendor</th>
                <th>Product</th>
                <th>Recipients</th>
                <th>Attempt</th>
                <th>Created</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">Loading dispatches…</div>
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <StagePill stage={record.status} />
                    </td>
                    <td>{record.company_name}</td>
                    <td>{record.product_name}</td>
                    <td>{record.recipient_emails?.join(", ")}</td>
                    <td>#{record.attempt_number}</td>
                    <td>{formatDateTime(record.created_at)}</td>
                    <td className={record.status === "failed" ? "danger-text" : ""}>
                      {record.error_message ||
                        (record.sent_at ? `Sent ${formatDateTime(record.sent_at)}` : "Pending")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-record-list dispatch-card-list">
          {isLoading ? (
            <div className="empty-state">Loading dispatches…</div>
          ) : records.length ? (
            records.map((record) => (
              <article className="mobile-record-card dispatch-card" key={record.id}>
                <div className="mobile-record-card-head">
                  <StagePill stage={record.status} />
                  <span>{formatDateTime(record.created_at)}</span>
                </div>
                <div className="mobile-record-fields">
                  <div className="mobile-record-field">
                    <span>Vendor</span>
                    <strong>{record.company_name || "—"}</strong>
                  </div>
                  <div className="mobile-record-field">
                    <span>Product</span>
                    <strong>{record.product_name || "—"}</strong>
                  </div>
                  <div className="mobile-record-field">
                    <span>Recipients</span>
                    <strong>{record.recipient_emails?.join(", ") || "—"}</strong>
                  </div>
                  <div className="mobile-record-field">
                    <span>Attempt</span>
                    <strong>#{record.attempt_number}</strong>
                  </div>
                  <div className="mobile-record-field mobile-record-field-wide">
                    <span>Result</span>
                    <strong className={record.status === "failed" ? "danger-text" : ""}>
                      {record.error_message ||
                        (record.sent_at ? `Sent ${formatDateTime(record.sent_at)}` : "Pending")}
                    </strong>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">No dispatches matched the current filter.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function EnquiryDetail({
  detail,
  onNotice,
  onError
}: {
  detail: RecordValue;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
}) {
  const queryClient = useQueryClient();
  const [activeItemId, setActiveItemId] = useState(detail.items?.[0]?.id ?? "");
  const [vendorSaving, setVendorSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [emailSelections, setEmailSelections] = useState<Record<string, string[]>>({});
  const vendorSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingVendorSaveCountRef = useRef(0);
  const vendorToggleVersionsRef = useRef<Record<string, number>>({});
  const activeItem = detail.items?.find((item: RecordValue) => item.id === activeItemId) ?? detail.items?.[0];
  const selectedVendors =
    detail.vendors?.filter((vendor: RecordValue) => vendor.enquiry_item_id === activeItem?.id) ?? [];
  const candidateQuery = useVendorCandidatesQuery(activeItem?.id ?? "", Boolean(activeItem?.product_id));
  const candidates = useMemo(
    () => (activeItem?.product_id && !candidateQuery.isPlaceholderData ? (candidateQuery.data?.records ?? []) : []),
    [activeItem?.product_id, candidateQuery.data?.records, candidateQuery.isPlaceholderData]
  );
  const candidateLoading = candidateQuery.isLoading || candidateQuery.isPlaceholderData;

  useEffect(() => {
    if (!detail.items?.some((item: RecordValue) => item.id === activeItemId)) {
      setActiveItemId(detail.items?.[0]?.id ?? "");
    }
  }, [activeItemId, detail.items]);

  useEffect(() => {
    const productItems = detail.items?.filter((item: RecordValue) => item.id && item.product_id) ?? [];
    productItems.forEach((item: RecordValue) => {
      void queryClient.prefetchQuery({
        queryKey: workflowQueryKeys.vendorCandidates(item.id),
        queryFn: () => workflowApi<{ records: RecordValue[] }>(`/api/enquiry-items/${item.id}/vendors`)
      });
    });
  }, [detail.items, queryClient]);

  useEffect(() => {
    if (candidateQuery.error) onError(message(candidateQuery.error));
  }, [candidateQuery.error, onError]);

  useEffect(() => {
    setEmailSelections((current) => {
      const next: Record<string, string[]> = {};
      for (const candidate of candidates) {
        if (!candidate.selected || !candidate.enquiry_vendor_id) continue;
        const vendorId = String(candidate.enquiry_vendor_id);
        const available = parseContactEmails(candidate.contact_email);
        const existing = (current[vendorId] ?? []).filter((email) => available.includes(email));
        next[vendorId] = existing.length ? existing : available;
      }
      return next;
    });
  }, [candidates, activeItem?.id]);

  function toggleVendorEmail(vendorId: string, email: string) {
    setEmailSelections((current) => {
      const selected = new Set(current[vendorId] ?? []);
      if (selected.has(email)) {
        if (selected.size <= 1) return current;
        selected.delete(email);
      } else {
        selected.add(email);
      }
      return { ...current, [vendorId]: [...selected] };
    });
  }

  const pendingVendorIds = candidates
    .filter((candidate) => candidate.selected && candidate.enquiry_vendor_id)
    .map((candidate) => String(candidate.enquiry_vendor_id))
    .filter((id) => !selectedVendors.some((vendor: RecordValue) => vendor.id === id && vendor.dispatch_status === "sent"));
  const hasEmailSelection = pendingVendorIds.every((vendorId) => (emailSelections[vendorId] ?? []).length > 0);

  function patchSelectedVendors(itemId: string, updatedCandidates: RecordValue[]) {
    queryClient.setQueryData<RecordValue>(workflowQueryKeys.enquiry(detail.id), (current) => {
      if (!current) return current;
      const existing = current.vendors ?? [];
      const existingForItem = new Map<string, RecordValue>(
        existing
          .filter((vendor: RecordValue) => vendor.enquiry_item_id === itemId)
          .map((vendor: RecordValue) => [String(vendor.company_id), vendor])
      );
      const updatedForItem = updatedCandidates
        .filter((candidate) => candidate.selected && candidate.enquiry_vendor_id)
        .map((candidate) => ({
          ...(existingForItem.get(candidate.company_id) ?? {}),
          id: candidate.enquiry_vendor_id,
          enquiry_item_id: itemId,
          company_id: candidate.company_id,
          company_name: candidate.company_name,
          contact_email: candidate.contact_email,
          dispatch_status: existingForItem.get(candidate.company_id)?.dispatch_status ?? null,
          response_status: existingForItem.get(candidate.company_id)?.response_status ?? "awaiting"
        }));

      return {
        ...current,
        vendors: [
          ...existing.filter((vendor: RecordValue) => vendor.enquiry_item_id !== itemId),
          ...updatedForItem
        ]
      };
    });
  }

  function toggleVendor(companyId: string) {
    if (!activeItem?.id || candidateQuery.isPlaceholderData) return;

    const itemId = activeItem.id;
    const queryKey = workflowQueryKeys.vendorCandidates(itemId);
    const previous = queryClient.getQueryData<VendorCandidatesResponse>(queryKey) ?? candidateQuery.data;
    const nextRecords = candidates.map((candidate) =>
      candidate.company_id === companyId ? { ...candidate, selected: !candidate.selected } : candidate
    );
    const selectedCompanyIds = nextRecords
      .filter((candidate) => candidate.selected)
      .map((candidate) => candidate.company_id);
    const version = (vendorToggleVersionsRef.current[itemId] ?? 0) + 1;

    vendorToggleVersionsRef.current[itemId] = version;
    queryClient.setQueryData<VendorCandidatesResponse>(queryKey, { records: nextRecords });
    pendingVendorSaveCountRef.current += 1;
    setVendorSaving(true);

    vendorSaveChainRef.current = vendorSaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const data = await workflowApi<{ records: RecordValue[] }>(`/api/enquiry-items/${itemId}/vendors`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyIds: selectedCompanyIds })
          });
          if (vendorToggleVersionsRef.current[itemId] === version) {
            queryClient.setQueryData(queryKey, data);
            patchSelectedVendors(itemId, data.records);
            void queryClient.invalidateQueries({ queryKey: workflowQueryKeys.enquiry(detail.id) });
          }
        } catch (value) {
          if (vendorToggleVersionsRef.current[itemId] === version) {
            queryClient.setQueryData(queryKey, previous);
            onError(message(value));
          }
        } finally {
          pendingVendorSaveCountRef.current -= 1;
          if (pendingVendorSaveCountRef.current <= 0) {
            pendingVendorSaveCountRef.current = 0;
            setVendorSaving(false);
          }
        }
      });
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
    const recipientEmails: Record<string, string[]> = {};
    for (const vendorId of vendorIds) {
      const emails = emailSelections[vendorId] ?? [];
      if (!emails.length) {
        onError("Select at least one email address for each vendor.");
        return;
      }
      recipientEmails[vendorId] = emails;
    }
    setSending(true);
    try {
      const result = await workflowApi<{ sent: number; failed: number }>("/api/enquiry-dispatches/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enquiryVendorIds: vendorIds, controlledAcknowledged: acknowledged, recipientEmails })
      });
      onNotice(`${result.sent} sent${result.failed ? ` · ${result.failed} failed` : ""}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowQueryKeys.enquiry(detail.id) }),
        queryClient.invalidateQueries({ queryKey: ["workflow", "dispatches"] })
      ]);
    } catch (value) {
      onError(message(value));
    } finally {
      setSending(false);
    }
  }

  async function updateResolution(resolution: string) {
    try {
      const updated = await workflowApi<RecordValue>(`/api/enquiries/${detail.id}/resolution`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution })
      });
      queryClient.setQueryData(workflowQueryKeys.enquiry(detail.id), updated);
      void queryClient.invalidateQueries({ queryKey: ["workflow", "enquiries"] });
      onNotice(`Enquiry marked ${resolution}.`);
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
          <p>
            {[detail.customer_company, detail.customer_email, detail.external_reference]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <select
          aria-label="Resolution"
          onChange={(event) => void updateResolution(event.target.value)}
          value={detail.resolution}
        >
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {detail.items?.length > 1 ? (
        <div className="item-tabs">
          {detail.items.map((item: RecordValue, index: number) => {
            const product = getProductDisplay(item);
            return (
              <button
                aria-label={`Item ${index + 1}: ${product.title}`}
                className={item.id === activeItem?.id ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setActiveItemId(item.id);
                  setAcknowledged(false);
                }}
                title={product.title}
                type="button"
              >
                <span>{index + 1}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeItem ? (
        <>
          <section className="item-summary">
            <div className="item-product-summary">
              <span>Product</span>
              <strong>{getProductDisplay(activeItem).primary}</strong>
              {getProductDisplay(activeItem).secondary ? (
                <small>{getProductDisplay(activeItem).secondary}</small>
              ) : null}
            </div>
            <div>
              <span>CAS</span>
              <strong>{activeItem.cas_number || "—"}</strong>
            </div>
            <div>
              <span>Quantity</span>
              <strong>
                {activeItem.quantities?.map((q: RecordValue) => `${q.quantity} ${q.unit}`).join(", ") || "—"}
              </strong>
            </div>
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
            <div>
              <p className="eyebrow">Supabase-derived network</p>
              <h4>Vendor candidates</h4>
            </div>
            <span>{vendorSaving ? "Saving selection…" : `${candidates.length} available`}</span>
          </div>
          <div className="candidate-list" aria-busy={vendorSaving}>
            {candidateLoading ? <p className="helper-note">Finding active facilities…</p> : null}
            {!candidateLoading && !activeItem.product_id ? (
              <p className="helper-note">Match this item to a catalog product before sourcing vendors.</p>
            ) : null}
            {candidates.map((candidate) => {
              const emails = parseContactEmails(candidate.contact_email);
              const vendorId = candidate.enquiry_vendor_id ? String(candidate.enquiry_vendor_id) : "";
              const selectedEmails = vendorId ? (emailSelections[vendorId] ?? emails) : emails;
              return (
                <div
                  className={candidate.selected ? "candidate-row selected" : "candidate-row"}
                  key={candidate.company_id}
                >
                  <button
                    className="candidate-row-main"
                    disabled={candidateQuery.isPlaceholderData}
                    onClick={() => toggleVendor(candidate.company_id)}
                    type="button"
                  >
                    <span className="candidate-check">{candidate.selected ? <Check size={14} /> : null}</span>
                    <span>
                      <strong>{candidate.company_name}</strong>
                      {!candidate.selected || emails.length > 1 ? (
                        <small>{candidate.contact_email}</small>
                      ) : (
                        <small>{selectedEmails[0]}</small>
                      )}
                    </span>
                    <span>
                      {candidate.facility_count} facilit{candidate.facility_count === 1 ? "y" : "ies"}
                    </span>
                  </button>
                  {candidate.selected && emails.length > 1 && vendorId ? (
                    <div className="candidate-email-picker">
                      <span className="candidate-email-label">Send to</span>
                      {emails.map((email) => (
                        <label className="candidate-email-option" key={email}>
                          <input
                            checked={selectedEmails.includes(email)}
                            onChange={() => toggleVendorEmail(vendorId, email)}
                            type="checkbox"
                          />
                          <span>{email}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {selectedVendors.length ? (
            <div className="sticky-action-bar">
              <div>
                <strong>
                  {selectedVendors.length} vendor{selectedVendors.length === 1 ? "" : "s"} selected
                </strong>
                <span>
                  {selectedVendors.filter((vendor: RecordValue) => vendor.dispatch_status === "sent").length}{" "}
                  already sent
                </span>
              </div>
              {activeItem.is_controlled ? (
                <label className="acknowledgement">
                  <input
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    type="checkbox"
                  />
                  I acknowledge the controlled-substance warning
                </label>
              ) : null}
              <button
                className="primary-button"
                disabled={sending || !hasEmailSelection || (activeItem.is_controlled && !acknowledged)}
                onClick={() => void sendSelected()}
                type="button"
              >
                <Send size={15} /> {sending ? "Sending…" : "Send enquiries"}
              </button>
            </div>
          ) : null}

          {selectedVendors.length ? (
            <div className="quote-list">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Responses</p>
                  <h4>Vendor quotes</h4>
                </div>
              </div>
              {selectedVendors.map((vendor: RecordValue) => (
                <QuoteRow
                  detailId={detail.id}
                  key={vendor.id}
                  vendor={vendor}
                  onError={onError}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function QuoteRow({
  detailId,
  vendor,
  onError
}: {
  detailId: string;
  vendor: RecordValue;
  onError: (value: string) => void;
}) {
  const queryClient = useQueryClient();
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
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.enquiry(detailId) });
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
        {vendor.price ? (
          <strong>
            {vendor.currency || ""} {vendor.price}
          </strong>
        ) : null}
        {vendor.lead_time_days !== null && vendor.lead_time_days !== undefined ? (
          <span>{vendor.lead_time_days} days</span>
        ) : null}
      </div>
      <button className="ghost-button" onClick={() => setEditing(true)} type="button">
        <CircleDollarSign size={15} /> Record quote
      </button>
      {editing ? (
        <div className="overlay">
          <form className="dialog quote-dialog" onSubmit={save}>
            <div className="dialog-head">
              <div>
                <p className="eyebrow">Vendor response</p>
                <h3>{vendor.company_name}</h3>
              </div>
              <button className="close-button" onClick={() => setEditing(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="form-grid">
              <Field label="Response">
                <select
                  value={form.responseStatus}
                  onChange={(e) => setForm({ ...form, responseStatus: e.target.value })}
                >
                  <option value="awaiting">Awaiting</option>
                  <option value="quoted">Quoted</option>
                  <option value="declined">Declined</option>
                  <option value="no_response">No response</option>
                </select>
              </Field>
              <Field label="Outcome">
                <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                  <option value="pending">Pending</option>
                  <option value="shortlisted">Shortlisted</option>
                  <option value="selected">Selected</option>
                  <option value="rejected">Rejected</option>
                </select>
              </Field>
              <Field label="Price">
                <input
                  min="0"
                  step="any"
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </Field>
              <Field label="Currency">
                <input
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                />
              </Field>
              <Field label="Lead time (days)">
                <input
                  min="0"
                  type="number"
                  value={form.leadTimeDays}
                  onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
                />
              </Field>
              <Field label="Packing">
                <input value={form.packing} onChange={(e) => setForm({ ...form, packing: e.target.value })} />
              </Field>
              <Field label="HSN code">
                <input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} />
              </Field>
              <Field label="Notes">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
            </div>
            <div className="dialog-actions dialog-footer">
              <button className="ghost-button" onClick={() => setEditing(false)} type="button">
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Save response
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function CreateEnquiryDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [header, setHeader] = useState({
    customerName: "",
    customerEmail: "",
    customerCompany: "",
    externalReference: "",
    enquiryType: "sourcing",
    receivedAt: new Date().toISOString().slice(0, 10),
    notes: ""
  });
  const [items, setItems] = useState<EnquiryDraftItem[]>([{ ...EMPTY_ITEM }]);
  const [results, setResults] = useState<Record<number, RecordValue[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const productSearchTimers = useRef<Record<number, number>>({});
  const productSearchControllers = useRef<Record<number, AbortController>>({});

  useEffect(
    () => () => {
      Object.values(productSearchTimers.current).forEach((timer) => window.clearTimeout(timer));
      Object.values(productSearchControllers.current).forEach((controller) => controller.abort());
    },
    []
  );

  function updateItem(index: number, patch: Partial<EnquiryDraftItem>) {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  }

  function searchProduct(index: number, value: string) {
    updateItem(index, { productName: value, productId: "", productCode: "" });

    window.clearTimeout(productSearchTimers.current[index]);
    productSearchControllers.current[index]?.abort();

    if (value.trim().length < 2) {
      setResults((current) => ({ ...current, [index]: [] }));
      return;
    }

    const controller = new AbortController();
    productSearchControllers.current[index] = controller;
    productSearchTimers.current[index] = window.setTimeout(() => {
      void workflowApi<{ records: RecordValue[] }>(
        `/api/enquiry-products?search=${encodeURIComponent(value)}`,
        { signal: controller.signal }
      )
        .then((data) => setResults((current) => ({ ...current, [index]: data.records })))
        .catch((value) => {
          if (!controller.signal.aborted) setError(message(value));
        });
    }, 220);
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="enquiry-dialog-overlay" />
        <Dialog.Content asChild>
          <form className="enquiry-dialog-content" onSubmit={submit}>
            <header className="enquiry-dialog-header">
              <div className="enquiry-dialog-title-icon">
                <Plus size={20} />
              </div>
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
              <StatusBanner variant="error">{error}</StatusBanner>

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
                  <Field label="Customer name">
                    <input
                      required
                      value={header.customerName}
                      onChange={(e) => setHeader({ ...header, customerName: e.target.value })}
                    />
                  </Field>
                  <Field label="Customer company">
                    <input
                      value={header.customerCompany}
                      onChange={(e) => setHeader({ ...header, customerCompany: e.target.value })}
                    />
                  </Field>
                  <Field label="Customer email">
                    <input
                      type="email"
                      value={header.customerEmail}
                      onChange={(e) => setHeader({ ...header, customerEmail: e.target.value })}
                    />
                  </Field>
                  <Field label="External reference">
                    <input
                      value={header.externalReference}
                      onChange={(e) => setHeader({ ...header, externalReference: e.target.value })}
                    />
                  </Field>
                  <Field label="Received date">
                    <input
                      required
                      type="date"
                      value={header.receivedAt}
                      onChange={(e) => setHeader({ ...header, receivedAt: e.target.value })}
                    />
                  </Field>
                  <Field label="Enquiry type">
                    <input
                      value={header.enquiryType}
                      onChange={(e) => setHeader({ ...header, enquiryType: e.target.value })}
                    />
                  </Field>
                  <div className="enquiry-notes-field">
                    <Field label="Notes">
                      <textarea
                        rows={3}
                        value={header.notes}
                        onChange={(e) => setHeader({ ...header, notes: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              </section>

              <section className="enquiry-form-section">
                <div className="enquiry-section-heading">
                  <div>
                    <span>02</span>
                    <div>
                      <h4>Requested materials</h4>
                      <p>
                        {items.length} item{items.length === 1 ? "" : "s"} in this enquiry.
                      </p>
                    </div>
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() => setItems([...items, { ...EMPTY_ITEM }])}
                    type="button"
                  >
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
                              <input
                                required={!item.casNumber}
                                title={item.productName}
                                value={item.productName}
                                onChange={(e) => void searchProduct(index, e.target.value)}
                                placeholder="Search by product name, code or CAS…"
                              />
                              {item.productId ? (
                                <span className="selected-product-code">
                                  Product code: {item.productCode || item.productId}
                                </span>
                              ) : null}
                              {results[index]?.length ? (
                                <div className="autocomplete-results">
                                  {results[index].map((product) => (
                                    <button
                                      key={product.id}
                                      onClick={() => {
                                        updateItem(index, {
                                          productId: product.id,
                                          productCode: product.product_code || product.id,
                                          productName:
                                            product.product_name ||
                                            `Product code: ${product.product_code || product.id}`,
                                          casNumber: product.cas_number || ""
                                        });
                                        setResults((current) => ({ ...current, [index]: [] }));
                                      }}
                                      type="button"
                                    >
                                      <strong>
                                        {product.product_name ||
                                          `Product code: ${product.product_code || product.id}`}
                                      </strong>
                                      <span>
                                        Code: {product.product_code || product.id}
                                        {product.cas_number ? ` · CAS: ${product.cas_number}` : ""}
                                        {product.is_controlled ? " · Controlled" : ""}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </Field>
                        </div>
                        <Field label="CAS number">
                          <input
                            value={item.casNumber}
                            onChange={(e) => updateItem(index, { casNumber: e.target.value, productId: "" })}
                          />
                        </Field>
                        <Field label="Quantity">
                          <input
                            min="0"
                            step="any"
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(index, { quantity: e.target.value })}
                          />
                        </Field>
                        <Field label="Unit">
                          <select
                            value={item.unit}
                            onChange={(e) => updateItem(index, { unit: e.target.value })}
                          >
                            <option value="g">g</option>
                            <option value="kg">kg</option>
                            <option value="MT">MT</option>
                            <option value="L">L</option>
                            <option value="KL">KL</option>
                          </select>
                        </Field>
                        <div className="draft-remarks-field">
                          <Field label="Remarks">
                            <input
                              value={item.remarks}
                              onChange={(e) => updateItem(index, { remarks: e.target.value })}
                            />
                          </Field>
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
                                    additionalQuantities: item.additionalQuantities.map(
                                      (entry, entryIndex) =>
                                        entryIndex === quantityIndex
                                          ? { ...entry, quantity: event.target.value }
                                          : entry
                                    )
                                  })
                                }
                              />
                              <select
                                aria-label={`Additional unit ${quantityIndex + 1}`}
                                value={quantity.unit}
                                onChange={(event) =>
                                  updateItem(index, {
                                    additionalQuantities: item.additionalQuantities.map(
                                      (entry, entryIndex) =>
                                        entryIndex === quantityIndex
                                          ? { ...entry, unit: event.target.value }
                                          : entry
                                    )
                                  })
                                }
                              >
                                <option value="g">g</option>
                                <option value="kg">kg</option>
                                <option value="MT">MT</option>
                                <option value="L">L</option>
                                <option value="KL">KL</option>
                              </select>
                              <button
                                aria-label={`Remove additional quantity ${quantityIndex + 1}`}
                                onClick={() =>
                                  updateItem(index, {
                                    additionalQuantities: item.additionalQuantities.filter(
                                      (_, entryIndex) => entryIndex !== quantityIndex
                                    )
                                  })
                                }
                                type="button"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                          <button
                            className="add-quantity-button"
                            onClick={() =>
                              updateItem(index, {
                                additionalQuantities: [
                                  ...item.additionalQuantities,
                                  { quantity: "", unit: "kg" }
                                ]
                              })
                            }
                            type="button"
                          >
                            <Plus size={14} /> Add another quantity
                          </button>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </div>

            <footer className="enquiry-dialog-footer">
              <button className="ghost-button" onClick={onClose} type="button">
                Cancel
              </button>
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

function ImportEnquiriesDialog({
  onClose,
  onImported
}: {
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [rows, setRows] = useState<RecordValue[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const enquiryGroupCount = useMemo(
    () =>
      new Set(
        rows.map((row, index) => {
          const reference = String(row.externalReference ?? "").trim();
          return reference || `row-${index}`;
        })
      ).size,
    [rows]
  );

  async function readFile(file: File | null) {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      const raw = XLSX.utils.sheet_to_json<RecordValue>(sheet, { defval: "", raw: false });
      const normalized = raw.map((row) => {
        const byKey = Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_"),
            value
          ])
        );
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
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Supabase import</p>
            <h3>Import enquiries</h3>
            <p className="dialog-copy">
              Rows with the same external reference become one multi-product enquiry.
            </p>
          </div>
          <button className="close-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <StatusBanner variant="error">{error}</StatusBanner>
        <label className="upload-zone">
          <input
            accept=".xlsx,.xls"
            onChange={(event) => void readFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <Upload size={24} />
          <strong>{fileName || "Choose Excel file"}</strong>
          <span>
            Expected: customer, date, product/CAS, quantity and UOM. External reference is optional.
          </span>
        </label>
        {rows.length ? (
          <div className="import-preview">
            <strong>{rows.length} rows ready</strong>
            <span>{enquiryGroupCount} enquiry groups</span>
          </div>
        ) : null}
        <div className="dialog-actions dialog-footer">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!rows.length || busy}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? "Importing…" : `Import ${rows.length || ""} rows`}
          </button>
        </div>
      </section>
    </div>
  );
}

function getProductDisplay(item: RecordValue) {
  const name = String(item.product_name ?? "").trim();
  const code = String(item.product_code ?? item.product_id ?? "").trim();
  const casNumber = String(item.cas_number ?? "").trim();
  const primary = name || (code ? `Product code: ${code}` : casNumber || "Unmatched material");
  const secondary = name && code ? `Product code: ${code}` : "";

  return {
    primary,
    secondary,
    title: [primary, secondary, casNumber ? `CAS: ${casNumber}` : ""].filter(Boolean).join(" · ")
  };
}

function StagePill({ stage }: { stage: string }) {
  const key = String(stage || "")
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll("_", "-");
  return <span className={`stage-pill stage-${key}`}>{stage || "Unknown"}</span>;
}

function SimpleBars({ rows }: { rows: RecordValue[] }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return rows.length ? (
    <div className="simple-bars">
      {rows.map((row) => (
        <div className="simple-bar" key={row.label}>
          <span>{row.label}</span>
          <div>
            <i style={{ width: `${Math.max(5, (Number(row.value) / max) * 100)}%` }} />
          </div>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  ) : (
    <div className="empty-state">No enquiry data yet.</div>
  );
}
