import { useQueryClient } from "@tanstack/react-query";
import { lazy, startTransition, useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Award,
  Beaker,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Factory,
  FlaskConical,
  History,
  Inbox,
  MapPinned,
  PackageSearch,
  ShieldAlert,
  UserRound
} from "lucide-react";
import type {
  AdminUser,
  ColumnMeta,
  FacilityRelationsResponse,
  FacilityRelationsUpsertRequest,
  ImportResponse,
  OptionRecord,
  OptionsResponse,
  RecordsResponse,
  TableMeta
} from "../shared/types";
import { apiRequest as api } from "./lib/api";
import { toDateTimeLocalValue } from "./lib/dates";
import { getErrorMessage } from "./lib/errors";
import { NavigationGroup } from "./app/AdminShell";
import { DataTable } from "./components/DataTable";
import { StatusBanner } from "./components/StatusBanner";
import {
  adminCrudQueryKeys,
  useRecordsQuery,
  useSchemaQuery
} from "./features/admin-crud/hooks";

const OverviewWorkspace = lazy(() => import("./features/workflow/OverviewWorkspace"));
const EnquiriesWorkspace = lazy(() => import("./features/workflow/EnquiriesWorkspace"));
const DispatchHistoryWorkspace = lazy(() => import("./features/workflow/DispatchHistoryWorkspace"));
const ProfileWorkspace = lazy(() => import("./ProfileWorkspace"));

type RowRecord = Record<string, unknown>;
type FormState = Record<string, string>;
type LookupCache = Record<string, OptionsResponse["options"]>;
type RelationSearchKey = "chemistries" | "products" | "accreditations";

interface EditorState {
  mode: "create" | "edit";
  row: RowRecord | null;
}

interface ImportState {
  fileName: string;
  sheetNames: string[];
  selectedSheetName: string;
  rowsBySheet: Record<string, RowRecord[]>;
  rows: RowRecord[];
}

interface ImportEditorState {
  rowIndex: number;
  formState: FormState;
}

const PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 100;
const IMPORT_PREVIEW_LIMIT = 50;

const RELATION_OPTION_LIMIT = 12;

const RELATION_KEYS = ["chemistries", "products", "accreditations"] as const;

const RELATION_TABLE_BY_KEY: Record<RelationSearchKey, string> = {
  chemistries: "chemistries",
  products: "products",
  accreditations: "accreditations"
};

const RELATION_LABEL_BY_KEY: Record<RelationSearchKey, string> = {
  chemistries: "Chemistries",
  products: "Products",
  accreditations: "Accreditations"
};

const EMPTY_RELATION_OPTIONS: Record<RelationSearchKey, OptionsResponse["options"]> = {
  chemistries: [],
  products: [],
  accreditations: []
};

interface AdminConsoleProps {
  adminUser?: AdminUser | null;
  onAdminUserChange: (user: AdminUser) => void;
}

export default function AdminConsole({ adminUser, onAdminUserChange }: AdminConsoleProps) {
  const queryClient = useQueryClient();
  const [selectedTableName, setSelectedTableName] = useState<string>("");
  const [activeView, setActiveView] = useState(() => readWorkspaceHash());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formState, setFormState] = useState<FormState>({});
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [importEditor, setImportEditor] = useState<ImportEditorState | null>(null);
  const [lookups, setLookups] = useState<LookupCache>({});
  const [facilityRelationsDraft, setFacilityRelationsDraft] = useState<FacilityRelationsUpsertRequest | null>(
    null
  );
  const [facilityRelationsLoading, setFacilityRelationsLoading] = useState(false);
  const [facilityRelationSearch, setFacilityRelationSearch] = useState<Record<RelationSearchKey, string>>({
    chemistries: "",
    products: "",
    accreditations: ""
  });
  const [facilityRelationOptions, setFacilityRelationOptions] =
    useState<Record<RelationSearchKey, OptionsResponse["options"]>>(EMPTY_RELATION_OPTIONS);
  const [facilityRelationOptionsLoading, setFacilityRelationOptionsLoading] = useState<
    Record<RelationSearchKey, boolean>
  >({
    chemistries: false,
    products: false,
    accreditations: false
  });
  const [activeFacilityRelationTab, setActiveFacilityRelationTab] =
    useState<RelationSearchKey>("chemistries");
  const [quickCreatingRelation, setQuickCreatingRelation] = useState<RelationSearchKey | null>(null);
  const isTableView = activeView.startsWith("table:");
  const schemaQuery = useSchemaQuery();
  const tables = useMemo(() => schemaQuery.data?.tables ?? [], [schemaQuery.data?.tables]);

  const selectedTable = useMemo(
    () => tables.find((table) => table.name === selectedTableName) ?? null,
    [selectedTableName, tables]
  );
  const recordsQuery = useRecordsQuery(selectedTable?.name ?? "", page, PAGE_SIZE, appliedSearch, isTableView);
  const activeRecordsQueryKey = selectedTable
    ? adminCrudQueryKeys.records(selectedTable.name, page, PAGE_SIZE, appliedSearch)
    : null;
  const records = useMemo(() => recordsQuery.data?.records ?? [], [recordsQuery.data?.records]);
  const total = recordsQuery.data?.total ?? 0;
  const loadingSchema = schemaQuery.isLoading;
  const loadingRecords = recordsQuery.isLoading || (recordsQuery.isFetching && !recordsQuery.data);

  function createEmptyFacilityRelationsDraft(): FacilityRelationsUpsertRequest {
    return {
      chemistries: [],
      products: [],
      accreditations: []
    };
  }

  function updateFacilityRelationsDraft(
    updater: (current: FacilityRelationsUpsertRequest) => FacilityRelationsUpsertRequest
  ) {
    setFacilityRelationsDraft((current) => updater(current ?? createEmptyFacilityRelationsDraft()));
  }

  function hasDuplicateValues(values: string[]) {
    const normalized = values.filter(Boolean);
    return new Set(normalized).size !== normalized.length;
  }

  function setFacilityRelationSearchValue(key: RelationSearchKey, value: string) {
    setFacilityRelationSearch((current) => ({
      ...current,
      [key]: value
    }));
  }

  function getRelationOptions(key: RelationSearchKey, selectedIds: string[]) {
    const selected = new Set(selectedIds.filter(Boolean));
    return (facilityRelationOptions[key] ?? []).filter((option) => !selected.has(option.value));
  }

  function getRelationOptionLabel(key: RelationSearchKey, id: string) {
    const options = [...(lookups[RELATION_TABLE_BY_KEY[key]] ?? []), ...(facilityRelationOptions[key] ?? [])];
    return options.find((option) => option.value === id)?.label ?? id;
  }

  function getRelationOption(key: RelationSearchKey, id: string) {
    const options = [...(lookups[RELATION_TABLE_BY_KEY[key]] ?? []), ...(facilityRelationOptions[key] ?? [])];
    return options.find((option) => option.value === id) ?? null;
  }

  const fetchOptions = useCallback(
    (
      tableName: string,
      {
        ids = "",
        limit = 50,
        search = "",
        signal,
        variant = ""
      }: { ids?: string; limit?: number; search?: string; signal?: AbortSignal; variant?: string } = {}
    ) =>
      queryClient.fetchQuery({
        queryKey: adminCrudQueryKeys.options(tableName, search, variant, ids, limit),
        queryFn: ({ signal: querySignal }) => {
          const params = new URLSearchParams({ limit: String(limit) });
          if (ids) params.set("ids", ids);
          if (search) params.set("search", search);
          if (variant) params.set("variant", variant);
          return api<OptionsResponse>(`/api/options/${tableName}?${params.toString()}`, {
            signal: signal ?? querySignal
          });
        },
        staleTime: 30_000
      }),
    [queryClient]
  );

  const mergeLookupOptions = useCallback((tableName: string, options: OptionsResponse["options"]) => {
    setLookups((current) => ({
      ...current,
      [tableName]: mergeOptions(current[tableName] ?? [], options)
    }));
  }, []);

  async function loadRelationOptionsByIds(key: RelationSearchKey, ids: string[]) {
    const missingIds = [...new Set(ids.filter((id) => id && !getRelationOption(key, id)))];
    if (missingIds.length === 0) {
      return;
    }

    const tableName = RELATION_TABLE_BY_KEY[key];
    const data = await fetchOptions(tableName, {
      ids: missingIds.join(","),
      limit: missingIds.length,
      variant: key === "products" ? "facility_relation" : ""
    });
    mergeLookupOptions(tableName, data.options);
  }

  const loadRelationOptions = useCallback(async (key: RelationSearchKey, search = "", signal?: AbortSignal) => {
    setFacilityRelationOptionsLoading((current) => ({ ...current, [key]: true }));

    const tableName = RELATION_TABLE_BY_KEY[key];
    const query = search.trim();
    if (key === "products" && query.length < 2) {
      setFacilityRelationOptions((current) => ({
        ...current,
        [key]: []
      }));
      setFacilityRelationOptionsLoading((current) => ({ ...current, [key]: false }));
      return [];
    }

    const data = await fetchOptions(tableName, {
      limit: RELATION_OPTION_LIMIT,
      search: query,
      signal,
      variant: key === "products" ? "facility_relation" : ""
    });

    setFacilityRelationOptions((current) => ({
      ...current,
      [key]: data.options
    }));
    mergeLookupOptions(tableName, data.options);
    setFacilityRelationOptionsLoading((current) => ({ ...current, [key]: false }));

    return data.options;
  }, [fetchOptions, mergeLookupOptions]);

  async function quickCreateRelationOption(
    key: RelationSearchKey,
    values: { name: string; casNumber?: string; productName?: string }
  ) {
    const name = values.name.trim();
    if (!name) {
      return;
    }

    const tableName = RELATION_TABLE_BY_KEY[key];
    const payload = buildQuickCreatePayload(key, name, values.casNumber);

    try {
      setQuickCreatingRelation(key);
      setError("");
      const created = await api<RowRecord>(`/api/records/${tableName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const createdId = String(created.id ?? "");
      if (!createdId) {
        throw new Error(`Created ${RELATION_LABEL_BY_KEY[key].toLowerCase()} record did not return an id.`);
      }

      await loadRelationOptions(key, key === "products" ? (values.casNumber ?? name) : name);
      if (key === "chemistries") {
        addChemistryRelation(createdId);
      }
      if (key === "products") {
        addProductRelation(createdId);
      }
      if (key === "accreditations") {
        addAccreditationRelation(createdId);
      }
      setNotice(`Created and linked ${key === "products" ? (values.casNumber ?? name) : name}.`);
    } catch (apiError) {
      setError(getErrorMessage(apiError));
    } finally {
      setQuickCreatingRelation(null);
    }
  }

  function addChemistryRelation(chemistryId: string) {
    if (!chemistryId) {
      return;
    }

    updateFacilityRelationsDraft((current) => ({
      ...current,
      chemistries: (current.chemistries ?? []).some((entry) => entry.chemistryId === chemistryId)
        ? (current.chemistries ?? [])
        : [...(current.chemistries ?? []), { chemistryId }]
    }));
    setFacilityRelationSearchValue("chemistries", "");
  }

  function addProductRelation(productId: string) {
    if (!productId) {
      return;
    }

    updateFacilityRelationsDraft((current) => ({
      ...current,
      products: (current.products ?? []).some((entry) => entry.productId === productId)
        ? (current.products ?? [])
        : [...(current.products ?? []), { productId, isPrimary: false }]
    }));
    setFacilityRelationSearchValue("products", "");
  }

  function addAccreditationRelation(accreditationId: string) {
    if (!accreditationId) {
      return;
    }

    updateFacilityRelationsDraft((current) => ({
      ...current,
      accreditations: (current.accreditations ?? []).some(
        (entry) => entry.accreditationId === accreditationId
      )
        ? (current.accreditations ?? [])
        : [
            ...(current.accreditations ?? []),
            {
              accreditationId,
              awardingBody: null,
              certificateNumber: null,
              awardedAt: null,
              expiresAt: null
            }
          ]
    }));
    setFacilityRelationSearchValue("accreditations", "");
  }
  const foreignTableNames = useMemo(() => {
    if (!selectedTable) {
      return [];
    }

    return [...new Set(selectedTable.columns.flatMap((column) => column.foreignKey?.referencesTable ?? []))];
  }, [selectedTable]);

  useEffect(() => {
    const handleHashChange = () => setActiveView(readWorkspaceHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!schemaQuery.data?.tables.length) {
      return;
    }

    const currentView = readWorkspaceHash();
    const requestedTable = currentView.startsWith("table:") ? currentView.slice("table:".length) : "";
    if (requestedTable && !selectedTableName) {
      setSelectedTableName(
        schemaQuery.data.tables.some((table) => table.name === requestedTable)
          ? requestedTable
          : schemaQuery.data.tables[0]?.name ?? ""
      );
    }
  }, [schemaQuery.data?.tables, selectedTableName]);

  useEffect(() => {
    if (schemaQuery.error) {
      setError(getErrorMessage(schemaQuery.error));
    }
  }, [schemaQuery.error]);

  useEffect(() => {
    if (recordsQuery.error) {
      setError(getErrorMessage(recordsQuery.error));
    }
  }, [recordsQuery.error]);

  useEffect(() => {
    if (!isTableView || !selectedTable || foreignTableNames.length === 0) {
      return;
    }

    for (const foreignTable of foreignTableNames) {
      if (lookups[foreignTable]) {
        continue;
      }

      void fetchOptions(foreignTable)
        .then((data) => {
          setLookups((current) => ({ ...current, [foreignTable]: data.options }));
        })
        .catch((apiError: unknown) => {
          setError(getErrorMessage(apiError));
        });
    }
  }, [fetchOptions, foreignTableNames, isTableView, lookups, selectedTable]);

  useEffect(() => {
    if (!isTableView || !selectedTable || records.length === 0) {
      return;
    }

    const foreignColumns = selectedTable.columns.filter((column) => column.foreignKey);
    for (const foreignTable of foreignTableNames) {
      const ids = [
        ...new Set(
          foreignColumns
            .filter((column) => column.foreignKey?.referencesTable === foreignTable)
            .flatMap((column) => records.map((record) => String(record[column.name] ?? "")))
            .filter(Boolean)
        )
      ].filter((id) => !(lookups[foreignTable] ?? []).some((option) => option.value === id));

      if (ids.length === 0) {
        continue;
      }

      void fetchOptions(foreignTable, { ids: ids.join(","), limit: ids.length })
        .then((data) => mergeLookupOptions(foreignTable, data.options))
        .catch((apiError: unknown) => setError(getErrorMessage(apiError)));
    }
  }, [fetchOptions, foreignTableNames, isTableView, lookups, mergeLookupOptions, records, selectedTable]);

  useEffect(() => {
    if (selectedTable?.name !== "facilities" || !editor) {
      return;
    }

    const controller = new AbortController();
    const key = activeFacilityRelationTab;
    const timer = window.setTimeout(() => {
      void loadRelationOptions(key, facilityRelationSearch[key], controller.signal).catch(
        (apiError: unknown) => {
          if (!controller.signal.aborted) {
            setFacilityRelationOptionsLoading((current) => ({ ...current, [key]: false }));
            setError(getErrorMessage(apiError));
          }
        }
      );
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeFacilityRelationTab, editor, facilityRelationSearch, loadRelationOptions, selectedTable?.name]);

  const visibleColumns = useMemo(() => {
    if (!selectedTable) {
      return [];
    }

    return selectedTable.listColumns
      .map((columnName) => selectedTable.columns.find((column) => column.name === columnName))
      .filter((column): column is ColumnMeta => Boolean(column));
  }, [selectedTable]);

  const editableColumns = useMemo(() => {
    if (!selectedTable) {
      return [];
    }

    if (selectedTable.readOnly) {
      return selectedTable.columns.filter((column) => !column.hidden);
    }

    return selectedTable.columns.filter((column) => !column.readOnly && !column.hidden);
  }, [selectedTable]);
  const editableFieldCount = editableColumns.filter((column) => !column.autoGenerated).length;
  const selectedTableDetails = useMemo(() => {
    if (!selectedTable) {
      return {
        autoManagedFields: [],
        connectedTableCount: 0,
        ignoredImportHeaders: [],
        importMatchers: [],
        importableColumns: []
      };
    }

    const autoManagedColumns = selectedTable.columns.filter(
      (column) => column.autoGenerated || column.readOnly
    );
    const ignoredColumns = selectedTable.columns.filter(
      (column) => column.autoGenerated || column.hidden || column.readOnly
    );
    const importableTableColumns = selectedTable.columns.filter(
      (column) => !column.autoGenerated && !column.hidden && !column.readOnly
    );

    return {
      autoManagedFields: autoManagedColumns.map((column) => column.label),
      connectedTableCount: selectedTable.columns.filter((column) => column.foreignKey).length,
      ignoredImportHeaders: ignoredColumns.map((column) => getImportHeaderName(column)),
      importMatchers: selectedTable.importMatchers ?? [],
      importableColumns: importableTableColumns
    };
  }, [selectedTable]);
  const { autoManagedFields, connectedTableCount, ignoredImportHeaders, importMatchers, importableColumns } =
    selectedTableDetails;
  const importHeaders = useMemo(
    () => ({
      optional: importableColumns
        .filter((column) => column.nullable || column.hasDefault)
        .map((column) => getImportHeaderName(column)),
      required: importableColumns
        .filter((column) => !column.nullable && !column.hasDefault)
        .map((column) => getImportHeaderName(column))
    }),
    [importableColumns]
  );
  const { optional: optionalImportHeaders, required: requiredImportHeaders } = importHeaders;
  const previewColumns = useMemo(() => {
    if (!selectedTable || !importState?.rows.length) {
      return [];
    }

    const hiddenHeaders = new Set(
      selectedTable.columns
        .filter((column) => column.autoGenerated || column.hidden || column.readOnly)
        .map((column) => column.name)
    );

    return Object.keys(importState.rows[0]).filter((column) => !hiddenHeaders.has(column));
  }, [importState?.rows, selectedTable]);
  const previewRows = useMemo(
    () => importState?.rows.slice(0, IMPORT_PREVIEW_LIMIT) ?? [],
    [importState?.rows]
  );
  const activeImportMatcher = useMemo(
    () =>
      importMatchers.find((matcher) => matcher.every((column) => previewColumns.includes(column))) ?? null,
    [importMatchers, previewColumns]
  );
  const importMatcherSummary = useMemo(
    () =>
      importMatchers.map((matcher) =>
        matcher
          .map((columnName) =>
            getImportHeaderName(
              selectedTable?.columns.find((column) => column.name === columnName) ?? columnName
            )
          )
          .join(" + ")
      ),
    [importMatchers, selectedTable]
  );
  const importMismatchMessage = useMemo(() => {
    if (
      !selectedTable ||
      !importState ||
      importState.rows.length === 0 ||
      importMatchers.length === 0 ||
      activeImportMatcher
    ) {
      return "";
    }

    return `This file cannot safely match existing ${selectedTable.label.toLowerCase()} entries yet. Include ${importMatcherSummary.join(
      " or "
    )} so imports update existing entries instead of creating duplicates.`;
  }, [activeImportMatcher, importMatcherSummary, importMatchers.length, importState, selectedTable]);

  function handleSearchSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setPage(0);
    setAppliedSearch(searchInput.trim());
  }

  function openCreateEditor() {
    if (!selectedTable) {
      return;
    }

    setNotice("");
    setFacilityRelationSearch({ chemistries: "", products: "", accreditations: "" });
    setActiveFacilityRelationTab("chemistries");
    setEditor({ mode: "create", row: null });
    setFormState(createEmptyForm(selectedTable));
    if (selectedTable.name === "facilities") {
      setFacilityRelationsDraft(createEmptyFacilityRelationsDraft());
    } else {
      setFacilityRelationsDraft(null);
    }
  }

  function openEditEditor(row: RowRecord) {
    if (!selectedTable) {
      return;
    }

    setNotice("");
    setFacilityRelationSearch({ chemistries: "", products: "", accreditations: "" });
    setActiveFacilityRelationTab("chemistries");
    setEditor({ mode: "edit", row });
    setFormState(createFormFromRow(selectedTable, row));

    if (selectedTable.name === "facilities") {
      const facilityId = String(row.id ?? "");
      if (facilityId) {
        void loadFacilityRelations(facilityId);
      }
    } else {
      setFacilityRelationsDraft(null);
    }
  }

  function closePanels() {
    setEditor(null);
    setImportState(null);
    setImportEditor(null);
    setFormState({});
    setFacilityRelationsDraft(null);
    setFacilityRelationSearch({ chemistries: "", products: "", accreditations: "" });
    setActiveFacilityRelationTab("chemistries");
  }

  function selectNavigationView(id: string) {
    const tableName = id.startsWith("table:") ? id.slice("table:".length) : "";
    if (!tables.some((table) => table.name === tableName)) {
      setError(
        `The ${tableName.replaceAll("_", " ")} workspace is not available until its Supabase migration is applied.`
      );
      return;
    }

    startTransition(() => {
      setSelectedTableName(tableName);
      setPage(0);
      setSearchInput("");
      setAppliedSearch("");
      setNotice("");
      setError("");
      closePanels();
      navigateWorkspace(id, setActiveView);
    });
  }

  function openImportEditor(row: RowRecord, rowIndex: number) {
    if (!selectedTable) {
      return;
    }

    setImportEditor({
      rowIndex,
      formState: createFormFromColumns(importableColumns, row)
    });
  }

  function closeImportEditor() {
    setImportEditor(null);
  }

  function handleImportSheetChange(sheetName: string) {
    setImportState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        selectedSheetName: sheetName,
        rows: current.rowsBySheet[sheetName] ?? []
      };
    });
    setImportEditor(null);
  }

  function handleDeleteImportRow(rowIndex: number) {
    if (!window.confirm(`Delete imported item #${rowIndex + 1}?`)) {
      return;
    }

    setImportState((current) => {
      if (!current) {
        return current;
      }

      const updatedRows = current.rows.filter((_, index) => index !== rowIndex);

      return {
        ...current,
        rows: updatedRows,
        rowsBySheet: {
          ...current.rowsBySheet,
          [current.selectedSheetName]: updatedRows
        }
      };
    });

    setImportEditor((current) => {
      if (!current) {
        return current;
      }

      if (current.rowIndex === rowIndex) {
        return null;
      }

      if (current.rowIndex > rowIndex) {
        return { ...current, rowIndex: current.rowIndex - 1 };
      }

      return current;
    });

    setNotice(`Removed imported item #${rowIndex + 1}.`);
  }

  function handleSaveImportRow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!importState || !importEditor) {
      return;
    }

    const updatedRow = buildRowFromForm(importableColumns, importEditor.formState);

    setImportState({
      ...importState,
      rows: importState.rows.map((row, index) => (index === importEditor.rowIndex ? updatedRow : row)),
      rowsBySheet: {
        ...importState.rowsBySheet,
        [importState.selectedSheetName]: importState.rows.map((row, index) =>
          index === importEditor.rowIndex ? updatedRow : row
        )
      }
    });
    setNotice(`Updated imported item #${importEditor.rowIndex + 1}.`);
    setImportEditor(null);
  }

  async function handleSaveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTable || !editor) {
      return;
    }

    try {
      if (selectedTable.readOnly) {
        throw new Error(`${selectedTable.label} is read-only.`);
      }

      setBusy(true);
      setError("");
      if (selectedTable.name === "facilities" && facilityRelationsDraft) {
        if (facilityRelationsDraft.chemistries?.some((row) => !row.chemistryId)) {
          throw new Error("Each chemistry entry must select a chemistry.");
        }
        if (facilityRelationsDraft.products?.some((row) => !row.productId)) {
          throw new Error("Each product entry must select a product.");
        }
        if (facilityRelationsDraft.accreditations?.some((row) => !row.accreditationId)) {
          throw new Error("Each accreditation entry must select an accreditation.");
        }
        if (hasDuplicateValues((facilityRelationsDraft.chemistries ?? []).map((row) => row.chemistryId))) {
          throw new Error("A facility cannot include the same chemistry more than once.");
        }
        if (hasDuplicateValues((facilityRelationsDraft.products ?? []).map((row) => row.productId))) {
          throw new Error("A facility cannot include the same product more than once.");
        }
        if (
          hasDuplicateValues((facilityRelationsDraft.accreditations ?? []).map((row) => row.accreditationId))
        ) {
          throw new Error("A facility cannot include the same accreditation more than once.");
        }
      }
      const payload = buildPayload(selectedTable, formState, editor);
      const method = editor.mode === "create" ? "POST" : "PATCH";
      const savedRow = await api<RowRecord>(`/api/records/${selectedTable.name}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (
        selectedTable.name === "facilities" &&
        facilityRelationsDraft &&
        String(savedRow.id ?? editor.row?.id ?? "")
      ) {
        const facilityId = String(savedRow.id ?? editor.row?.id ?? "");
        const relations = await api<FacilityRelationsResponse>(`/api/facilities/${facilityId}/relations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(facilityRelationsDraft)
        });
        queryClient.setQueryData(adminCrudQueryKeys.facilityRelations(facilityId), relations);
      }

      if (activeRecordsQueryKey) {
        queryClient.setQueryData<RecordsResponse>(activeRecordsQueryKey, (current) => {
          if (!current) return current;
          const savedKey = createRowKey(selectedTable, savedRow, -1);
          const existingIndex = current.records.findIndex(
            (row, index) => createRowKey(selectedTable, row, index) === savedKey
          );
          if (existingIndex >= 0) {
            return {
              ...current,
              records: current.records.map((row, index) => (index === existingIndex ? savedRow : row))
            };
          }
          return {
            ...current,
            records: page === 0 ? [savedRow, ...current.records].slice(0, PAGE_SIZE) : current.records,
            total: current.total + (editor.mode === "create" ? 1 : 0)
          };
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["admin-crud", "options", selectedTable.name] });
      setNotice(
        editor.mode === "create"
          ? `${selectedTable.label} entry created.`
          : `${selectedTable.label} entry updated.`
      );
      closePanels();
    } catch (apiError) {
      setError(getErrorMessage(apiError));
    } finally {
      setBusy(false);
    }
  }

  async function loadFacilityRelations(facilityId: string) {
    try {
      setFacilityRelationsLoading(true);
      setError("");

      const data = await queryClient.fetchQuery({
        queryKey: adminCrudQueryKeys.facilityRelations(facilityId),
        queryFn: () => api<FacilityRelationsResponse>(`/api/facilities/${facilityId}/relations`),
        staleTime: 30_000
      });
      await hydrateFacilityRelationLabels(data);
      setFacilityRelationsDraft({
        chemistries: data.chemistries.map((row) => ({
          chemistryId: row.chemistryId
        })),
        products: data.products.map((row) => ({
          productId: row.productId,
          isPrimary: row.isPrimary
        })),
        accreditations: data.accreditations.map((row) => ({
          accreditationId: row.accreditationId,
          awardingBody: row.awardingBody,
          certificateNumber: row.certificateNumber,
          awardedAt: row.awardedAt,
          expiresAt: row.expiresAt
        }))
      });
    } catch (apiError: unknown) {
      setError(getErrorMessage(apiError));
    } finally {
      setFacilityRelationsLoading(false);
    }
  }

  async function hydrateFacilityRelationLabels(data: FacilityRelationsResponse) {
    await Promise.all([
      loadRelationOptionsByIds(
        "chemistries",
        data.chemistries.map((row) => row.chemistryId)
      ),
      loadRelationOptionsByIds(
        "products",
        data.products.map((row) => row.productId)
      ),
      loadRelationOptionsByIds(
        "accreditations",
        data.accreditations.map((row) => row.accreditationId)
      )
    ]);
  }

  async function handleDeleteRecord(row: RowRecord) {
    if (!selectedTable) {
      return;
    }

    const identifier = getRowTitle(selectedTable, row, lookups);

    if (!window.confirm(`Delete this entry?\n${identifier}`)) {
      return;
    }

    try {
      setBusy(true);
      setError("");
      await api(`/api/records/${selectedTable.name}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row)
      });

      const deletedRowKey = createRowKey(selectedTable, row, -1);
      if (activeRecordsQueryKey) {
        queryClient.setQueryData<RecordsResponse>(activeRecordsQueryKey, (current) =>
          current
            ? {
                ...current,
                records: current.records.filter(
                  (currentRow, index) => createRowKey(selectedTable, currentRow, index) !== deletedRowKey
                ),
                total: Math.max(0, current.total - 1)
              }
            : current
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["admin-crud", "options", selectedTable.name] });
      setNotice(`${selectedTable.label} entry deleted.`);
    } catch (apiError) {
      setError(getErrorMessage(apiError));
    } finally {
      setBusy(false);
    }
  }

  async function refreshRecords() {
    if (!selectedTable) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: ["admin-crud", "records", selectedTable.name]
    });
  }

  async function handleRefreshClick() {
    if (!selectedTable || loadingRecords || refreshing) {
      return;
    }

    try {
      setRefreshing(true);
      setError("");
      await refreshRecords();
    } catch (apiError) {
      setError(getErrorMessage(apiError));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleExportClick() {
    if (!selectedTable) {
      return;
    }

    try {
      setExporting(true);
      setError("");
      const rows = await fetchRecordsForExport(selectedTable.name, appliedSearch);
      const exportColumns = selectedTable.columns.filter((column) => !column.hidden);
      const worksheetRows = rows.map((row) =>
        Object.fromEntries(
          exportColumns.map((column) => [
            getImportHeaderName(column),
            getExportCellValue(column, row, lookups)
          ])
        )
      );
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(worksheetRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        selectedTable.label.slice(0, 31) || selectedTable.name
      );
      XLSX.writeFile(workbook, createExportFilename(selectedTable.name));
      setNotice(`Exported ${rows.length} ${selectedTable.label.toLowerCase()} entries to Excel.`);
    } catch (exportError) {
      setError(getErrorMessage(exportError));
    } finally {
      setExporting(false);
    }
  }

  async function handleImportSubmit() {
    if (!selectedTable || !importState) {
      return;
    }

    if (importMismatchMessage) {
      setError(importMismatchMessage);
      return;
    }

    try {
      setBusy(true);
      setError("");
      const response = await api<ImportResponse>(`/api/import/${selectedTable.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importState.rows })
      });

      setNotice(
        `Imported ${response.processed} entries into ${selectedTable.label} (${response.created} created, ${response.updated} updated).`
      );
      closePanels();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-crud", "records", selectedTable.name] }),
        queryClient.invalidateQueries({ queryKey: ["admin-crud", "options", selectedTable.name] })
      ]);
    } catch (apiError) {
      setError(getErrorMessage(apiError));
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelected(file: File | null) {
    if (!file) {
      return;
    }

    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: false
      });
      const rowsBySheet = Object.fromEntries(
        workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const parsedRows = XLSX.utils.sheet_to_json<RowRecord>(sheet, {
            defval: "",
            raw: false
          });
          const rows = selectedTable
            ? parsedRows.map((row) => normalizeImportedRow(selectedTable, row))
            : parsedRows;
          return [sheetName, rows];
        })
      );
      const selectedSheetName = workbook.SheetNames[0] ?? "";

      setImportState({
        fileName: file.name,
        sheetNames: workbook.SheetNames,
        selectedSheetName,
        rowsBySheet,
        rows: rowsBySheet[selectedSheetName] ?? []
      });
      setImportEditor(null);
      setNotice("");
    } catch (parseError) {
      setError(`Could not read Excel file: ${getErrorMessage(parseError)}`);
    }
  }

  if (loadingSchema) {
    return <div className="shell loading-screen">Loading admin tools...</div>;
  }

  if (isTableView && !selectedTable) {
    return <div className="shell loading-screen">No admin tools are configured.</div>;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFacilityEditor = selectedTable?.name === "facilities" && Boolean(editor);

  return (
    <div className={sidebarCollapsed ? "shell sidebar-collapsed" : "shell"}>
      <aside className="sidebar">
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          {sidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>

        <div className="brand">
          <p className="eyebrow">Admin Console</p>
          <h1>Covenants</h1>
          <p className="sidebar-copy">Sourcing operations and trusted marketplace data.</p>
        </div>

        <nav className="nav-groups" aria-label="Admin navigation">
          <NavigationGroup
            activeView={activeView}
            collapsed={sidebarCollapsed}
            label="Overview"
            items={[{ id: "overview", label: "Overview", icon: <CircleGauge size={18} /> }]}
            onSelect={(id) => navigateWorkspace(id, setActiveView)}
          />
          <NavigationGroup
            activeView={activeView}
            collapsed={sidebarCollapsed}
            label="Workflow"
            items={[
              { id: "enquiries", label: "Enquiries", icon: <Inbox size={18} /> },
              { id: "dispatches", label: "Dispatch History", icon: <History size={18} /> }
            ]}
            onSelect={(id) => navigateWorkspace(id, setActiveView)}
          />
          <NavigationGroup
            activeView={activeView}
            collapsed={sidebarCollapsed}
            label="Network"
            items={[
              { id: "table:companies", label: "Companies", icon: <Building2 size={18} /> },
              { id: "table:facilities", label: "Facilities", icon: <Factory size={18} /> }
            ]}
            onSelect={(id) => selectNavigationView(id)}
          />
          <NavigationGroup
            activeView={activeView}
            collapsed={sidebarCollapsed}
            label="Catalog"
            items={[
              { id: "table:products", label: "Products", icon: <PackageSearch size={18} /> },
              { id: "table:chemistries", label: "Chemistries", icon: <FlaskConical size={18} /> }
            ]}
            onSelect={(id) => selectNavigationView(id)}
          />
          <NavigationGroup
            activeView={activeView}
            collapsed={sidebarCollapsed}
            label="Governance"
            items={[
              {
                id: "table:controlled_substances",
                label: "Controlled Substances",
                icon: <ShieldAlert size={18} />
              },
              { id: "table:accreditations", label: "Accreditations", icon: <Award size={18} /> },
              { id: "table:regions", label: "Regions", icon: <MapPinned size={18} /> },
              { id: "table:products_dedupe_audit", label: "Dedupe Audit", icon: <Beaker size={18} /> }
            ]}
            onSelect={(id) => selectNavigationView(id)}
          />
          <NavigationGroup
            activeView={activeView}
            collapsed={sidebarCollapsed}
            label="Account"
            items={[{ id: "profile", label: "Profile", icon: <UserRound size={18} /> }]}
            onSelect={(id) => navigateWorkspace(id, setActiveView)}
          />
        </nav>
      </aside>

      <main className="workspace">
        {activeView === "overview" ? (
          <OverviewWorkspace onOpenEnquiries={() => navigateWorkspace("enquiries", setActiveView)} />
        ) : activeView === "enquiries" ? (
          <EnquiriesWorkspace />
        ) : activeView === "dispatches" ? (
          <DispatchHistoryWorkspace />
        ) : activeView === "profile" ? (
          <ProfileWorkspace adminUser={adminUser} onAdminUserChange={onAdminUserChange} />
        ) : selectedTable ? (
          <>
            <section className="workspace-header">
              <div className="table-summary">
                <div className="table-title-block">
                  <p className="eyebrow">Workspace</p>
                  <h2>{selectedTable.label}</h2>
                  <p className="hero-copy">
                    {selectedTable.description ??
                      `Manage ${selectedTable.label.toLowerCase()} with safe forms, bulk import, and protected system fields.`}
                  </p>
                </div>

                <div className="hero-stats" aria-label="Workspace stats">
                  <div className="stat-card">
                    <span>Total Entries</span>
                    <strong>{total}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Editable</span>
                    <strong>{editableFieldCount}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Connected</span>
                    <strong>{connectedTableCount}</strong>
                  </div>
                </div>
              </div>

              <div className="header-actions">
                <button
                  className="ghost-button button-with-spinner"
                  disabled={loadingRecords || refreshing}
                  onClick={() => void handleRefreshClick()}
                  type="button"
                >
                  {refreshing ? <span aria-hidden="true" className="spin" /> : null}
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  className="ghost-button button-with-spinner"
                  disabled={loadingRecords || exporting}
                  onClick={() => void handleExportClick()}
                  type="button"
                >
                  {exporting ? <span aria-hidden="true" className="spin" /> : null}
                  {exporting ? "Exporting…" : "Export"}
                </button>
                <button
                  className="ghost-button"
                  disabled={selectedTable.readOnly}
                  onClick={() =>
                    setImportState({
                      fileName: "",
                      sheetNames: [],
                      selectedSheetName: "",
                      rowsBySheet: {},
                      rows: []
                    })
                  }
                  type="button"
                >
                  Import
                </button>
                <button
                  className="primary-button"
                  disabled={selectedTable.readOnly}
                  onClick={openCreateEditor}
                  type="button"
                >
                  Add Entry
                </button>
              </div>
            </section>

            <section className="panel controls">
              <div className="controls-copy">
                <form className="search-form" onSubmit={handleSearchSubmit}>
                  <label className="search">
                    <span>Search entries</span>
                    <div className="search-input-group">
                      <input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder={`Search ${selectedTable.label.toLowerCase()}...`}
                        type="search"
                      />
                      <button className="ghost-button" disabled={loadingRecords} type="submit">
                        Search
                      </button>
                    </div>
                  </label>
                </form>
                <p className="helper-note">
                  System-managed fields stay hidden. Imports ignore them even if they appear in the sheet.
                </p>
              </div>
            </section>

            <StatusBanner variant="error">{error}</StatusBanner>
            <StatusBanner variant="success">{notice}</StatusBanner>

            <DataTable
              columns={visibleColumns}
              createRowKey={createRowKey}
              formatColumnValue={formatColumnValue}
              loading={loadingRecords}
              lookups={lookups}
              onDelete={(row) => void handleDeleteRecord(row)}
              onEdit={openEditEditor}
              page={page}
              pageCount={pageCount}
              records={records}
              setPage={setPage}
              table={selectedTable}
            />
          </>
        ) : (
          <div className="empty-state">Choose a workspace from the sidebar.</div>
        )}
      </main>

      {editor && selectedTable ? (
        <div className="overlay">
          <section className="dialog">
            <div className="dialog-head">
              <div>
                <p className="eyebrow">
                  {selectedTable.readOnly ? "View" : editor.mode === "create" ? "Create" : "Edit"}
                </p>
                <h3>{selectedTable.label} Entry</h3>
                <p className="dialog-copy">
                  {selectedTable.readOnly
                    ? "This audit area is read-only."
                    : "System-managed fields like generated IDs and timestamps stay hidden automatically."}
                </p>
              </div>
              <button className="close-button" onClick={closePanels} type="button">
                Close
              </button>
            </div>

            <form className="record-form" onSubmit={(event) => void handleSaveRecord(event)}>
              <div className="form-grid">
                {editableColumns.map((column) => {
                  const disabled = selectedTable.readOnly || (editor.mode === "edit" && column.isPrimaryKey);
                  const foreignOptions = column.foreignKey
                    ? (lookups[column.foreignKey.referencesTable] ?? [])
                    : [];

                  return (
                    <label className="field" key={column.name}>
                      <span>
                        {column.label}
                        {column.nullable ? " optional" : ""}
                      </span>

                      {column.foreignKey ? (
                        <select
                          disabled={disabled}
                          value={formState[column.name] ?? ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              [column.name]: event.target.value
                            }))
                          }
                        >
                          <option value="">Select {column.label}</option>
                          {foreignOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        renderFieldInput(column, formState[column.name] ?? "", disabled, (value) =>
                          setFormState((current) => ({
                            ...current,
                            [column.name]: value
                          }))
                        )
                      )}
                    </label>
                  );
                })}
              </div>

              {isFacilityEditor ? (
                <FacilityRelationsEditor
                  activeTab={activeFacilityRelationTab}
                  busy={busy}
                  draft={facilityRelationsDraft ?? createEmptyFacilityRelationsDraft()}
                  getLabel={getRelationOptionLabel}
                  getOption={getRelationOption}
                  loading={facilityRelationsLoading}
                  optionsLoading={facilityRelationOptionsLoading}
                  quickCreating={quickCreatingRelation}
                  search={facilityRelationSearch}
                  onAddAccreditation={addAccreditationRelation}
                  onAddChemistry={addChemistryRelation}
                  onAddProduct={addProductRelation}
                  onQuickCreate={(key, values) => void quickCreateRelationOption(key, values)}
                  onSearchChange={setFacilityRelationSearchValue}
                  onTabChange={setActiveFacilityRelationTab}
                  onUpdateDraft={updateFacilityRelationsDraft}
                  getAvailableOptions={getRelationOptions}
                />
              ) : null}

              {autoManagedFields.length > 0 ? (
                <div className="auto-managed-note">
                  <strong>Handled automatically:</strong> {autoManagedFields.join(", ")}
                </div>
              ) : null}

              <div className="dialog-actions dialog-footer">
                <button className="ghost-button" onClick={closePanels} type="button">
                  Close
                </button>
                {selectedTable.readOnly ? null : (
                  <button className="primary-button" disabled={busy} type="submit">
                    {busy ? "Saving..." : editor.mode === "create" ? "Create Entry" : "Save Changes"}
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {importState && selectedTable ? (
        <div className="overlay">
          <section className="dialog import-dialog">
            <div className="dialog-head">
              <div>
                <p className="eyebrow">Excel Import</p>
                <h3>{selectedTable.label}</h3>
                <p className="dialog-copy">
                  Match spreadsheet headers to the supported import fields. Existing entries are updated when
                  the matching fields line up, blank cells keep existing values, and system-managed fields are
                  ignored.
                </p>
              </div>
            </div>

            <label className="upload-zone">
              <input
                accept=".xlsx,.xls,.csv"
                onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)}
                type="file"
              />
              <span>Choose an Excel file whose headers match the supported import fields.</span>
            </label>

            <div className="import-summary">
              <strong>{importState.fileName || "No file selected yet"}</strong>
              <span>
                {importState.selectedSheetName ? `Sheet: ${importState.selectedSheetName} · ` : ""}
                {importState.rows.length} parsed entries
              </span>
            </div>

            {importState.sheetNames.length > 1 ? (
              <label className="field import-sheet-field">
                <span>Choose worksheet</span>
                <select
                  value={importState.selectedSheetName}
                  onChange={(event) => handleImportSheetChange(event.target.value)}
                >
                  {importState.sheetNames.map((sheetName) => (
                    <option key={sheetName} value={sheetName}>
                      {sheetName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="auto-managed-note">
              <strong>Excel headers</strong>
              <p className="helper-note import-helper">
                Your spreadsheet headers must match these names exactly.
              </p>
              <div className="import-header-grid">
                <div>
                  <strong>Required:</strong>{" "}
                  {requiredImportHeaders.length > 0
                    ? requiredImportHeaders.map((name) => (
                        <code className="import-code" key={`req-${name}`}>
                          {name}
                        </code>
                      ))
                    : "None"}
                </div>
                <div>
                  <strong>Optional:</strong>{" "}
                  {optionalImportHeaders.length > 0
                    ? optionalImportHeaders.map((name) => (
                        <code className="import-code" key={`opt-${name}`}>
                          {name}
                        </code>
                      ))
                    : "None"}
                </div>
                <div>
                  <strong>Matches Existing Entries By:</strong>{" "}
                  {importMatcherSummary.length > 0
                    ? importMatcherSummary.map((name) => (
                        <code className="import-code" key={`match-${name}`}>
                          {name}
                        </code>
                      ))
                    : "Primary key"}
                </div>
                <div>
                  <strong>Ignored:</strong>{" "}
                  {ignoredImportHeaders.length > 0
                    ? ignoredImportHeaders.map((name) => (
                        <code className="import-code" key={`ign-${name}`}>
                          {name}
                        </code>
                      ))
                    : "None"}
                </div>
              </div>
            </div>

            {importMismatchMessage ? (
              <div className="helper-note import-warning" role="alert">
                {importMismatchMessage}
              </div>
            ) : activeImportMatcher ? (
              <div className="helper-note import-match-note">
                This file will match existing entries using <code>{activeImportMatcher.join(" + ")}</code>.
                Non-empty cells update matching entries, while blank cells keep the current value.
              </div>
            ) : null}

            {importState.rows.length > IMPORT_PREVIEW_LIMIT ? (
              <div className="helper-note">
                Showing the first {IMPORT_PREVIEW_LIMIT} of {importState.rows.length} parsed entries. All rows
                will be imported.
              </div>
            ) : null}

            {importState.rows.length > 0 ? (
              <div className="preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {previewColumns.map((column) => (
                        <th key={column}>
                          {getImportHeaderName(
                            selectedTable.columns.find((entry) => entry.name === column) ?? column
                          )}
                        </th>
                      ))}
                      <th className="actions-column" scope="col">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr key={`preview-${rowIndex}`}>
                        <td>{rowIndex + 1}</td>
                        {previewColumns.map((column) => (
                          <td key={column}>{formatCellValue(row[column])}</td>
                        ))}
                        <td className="actions-cell">
                          <div className="row-actions">
                            <button onClick={() => openImportEditor(row, rowIndex)} type="button">
                              Edit
                            </button>
                            <button
                              className="danger-link"
                              onClick={() => handleDeleteImportRow(rowIndex)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="dialog-actions dialog-footer">
              <button className="ghost-button" onClick={closePanels} type="button">
                Close
              </button>
              <button
                className="primary-button"
                disabled={busy || importState.rows.length === 0 || Boolean(importMismatchMessage)}
                onClick={() => void handleImportSubmit()}
                type="button"
              >
                {busy ? "Importing..." : "Import Entries"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {importEditor && selectedTable ? (
        <div className="overlay">
          <section className="dialog">
            <div className="dialog-head">
              <div>
                <p className="eyebrow">Edit Imported Entry</p>
                <h3>
                  {selectedTable.label} Entry #{importEditor.rowIndex + 1}
                </h3>
                <p className="dialog-copy">Review this parsed entry before importing it.</p>
              </div>
              <button className="close-button" onClick={closeImportEditor} type="button">
                Close
              </button>
            </div>

            <form className="record-form" onSubmit={handleSaveImportRow}>
              <div className="form-grid">
                {importableColumns.map((column) => {
                  const foreignOptions = column.foreignKey
                    ? (lookups[column.foreignKey.referencesTable] ?? [])
                    : [];

                  return (
                    <label className="field" key={`import-${column.name}`}>
                      <span>
                        {column.label}
                        {column.nullable ? " optional" : ""}
                      </span>

                      {column.foreignKey ? (
                        <select
                          value={importEditor.formState[column.name] ?? ""}
                          onChange={(event) =>
                            setImportEditor((current) =>
                              current
                                ? {
                                    ...current,
                                    formState: {
                                      ...current.formState,
                                      [column.name]: event.target.value
                                    }
                                  }
                                : current
                            )
                          }
                        >
                          <option value="">Select {column.label}</option>
                          {foreignOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        renderFieldInput(column, importEditor.formState[column.name] ?? "", false, (value) =>
                          setImportEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  formState: {
                                    ...current.formState,
                                    [column.name]: value
                                  }
                                }
                              : current
                          )
                        )
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="dialog-actions dialog-footer">
                <button className="ghost-button" onClick={closeImportEditor} type="button">
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Save Entry
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

interface FacilityRelationsEditorProps {
  activeTab: RelationSearchKey;
  busy: boolean;
  draft: FacilityRelationsUpsertRequest;
  getAvailableOptions: (key: RelationSearchKey, selectedIds: string[]) => OptionsResponse["options"];
  getLabel: (key: RelationSearchKey, id: string) => string;
  getOption: (key: RelationSearchKey, id: string) => OptionRecord | null;
  loading: boolean;
  optionsLoading: Record<RelationSearchKey, boolean>;
  quickCreating: RelationSearchKey | null;
  search: Record<RelationSearchKey, string>;
  onAddAccreditation: (id: string) => void;
  onAddChemistry: (id: string) => void;
  onAddProduct: (id: string) => void;
  onQuickCreate: (
    key: RelationSearchKey,
    values: { name: string; casNumber?: string; productName?: string }
  ) => void;
  onSearchChange: (key: RelationSearchKey, value: string) => void;
  onTabChange: (key: RelationSearchKey) => void;
  onUpdateDraft: (
    updater: (current: FacilityRelationsUpsertRequest) => FacilityRelationsUpsertRequest
  ) => void;
}

function FacilityRelationsEditor({
  activeTab,
  busy,
  draft,
  getAvailableOptions,
  getLabel,
  getOption,
  loading,
  optionsLoading,
  quickCreating,
  search,
  onAddAccreditation,
  onAddChemistry,
  onAddProduct,
  onQuickCreate,
  onSearchChange,
  onTabChange,
  onUpdateDraft
}: FacilityRelationsEditorProps) {
  const disabled = busy || loading;
  const selectedIdsByKey: Record<RelationSearchKey, string[]> = {
    chemistries: (draft.chemistries ?? []).map((entry) => entry.chemistryId),
    products: (draft.products ?? []).map((entry) => entry.productId),
    accreditations: (draft.accreditations ?? []).map((entry) => entry.accreditationId)
  };
  const counts: Record<RelationSearchKey, number> = {
    chemistries: draft.chemistries?.length ?? 0,
    products: draft.products?.length ?? 0,
    accreditations: draft.accreditations?.length ?? 0
  };

  return (
    <section className="relation-editor">
      <div className="relation-editor-head">
        <div>
          <strong>Facility relations</strong>
          <p className="helper-note">
            Search existing catalog items or create missing ones without leaving this form.
          </p>
        </div>
        {loading ? <span className="relation-status">Loading relations...</span> : null}
      </div>

      <div className="relation-tabs" role="tablist" aria-label="Facility relation sections">
        {RELATION_KEYS.map((key) => (
          <button
            key={key}
            className={activeTab === key ? "relation-tab active" : "relation-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => onTabChange(key)}
          >
            <span>{RELATION_LABEL_BY_KEY[key]}</span>
            <strong>{counts[key]}</strong>
          </button>
        ))}
      </div>

      <div className="relation-tab-panel" role="tabpanel">
        <RelationSearchBox
          disabled={disabled}
          label={getRelationSingularLabel(activeTab)}
          loading={optionsLoading[activeTab]}
          options={getAvailableOptions(activeTab, selectedIdsByKey[activeTab])}
          quickCreating={quickCreating === activeTab}
          search={search[activeTab]}
          type={activeTab}
          onAdd={(id) => {
            if (activeTab === "chemistries") {
              onAddChemistry(id);
            }
            if (activeTab === "products") {
              onAddProduct(id);
            }
            if (activeTab === "accreditations") {
              onAddAccreditation(id);
            }
          }}
          onQuickCreate={(values) => onQuickCreate(activeTab, values)}
          onSearchChange={(value) => onSearchChange(activeTab, value)}
        />

        {activeTab === "chemistries" ? (
          <ChemistryRelations
            disabled={disabled}
            rows={draft.chemistries ?? []}
            getLabel={(id) => getLabel("chemistries", id)}
            onRemove={(index) =>
              onUpdateDraft((current) => ({
                ...current,
                chemistries: (current.chemistries ?? []).filter((_entry, entryIndex) => entryIndex !== index)
              }))
            }
          />
        ) : null}

        {activeTab === "products" ? (
          <ProductRelations
            disabled={disabled}
            rows={draft.products ?? []}
            getOption={(id) => getOption("products", id)}
            getLabel={(id) => getLabel("products", id)}
            onPrimaryChange={(index, isPrimary) =>
              onUpdateDraft((current) => ({
                ...current,
                products: (current.products ?? []).map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, isPrimary } : entry
                )
              }))
            }
            onRemove={(index) =>
              onUpdateDraft((current) => ({
                ...current,
                products: (current.products ?? []).filter((_entry, entryIndex) => entryIndex !== index)
              }))
            }
          />
        ) : null}

        {activeTab === "accreditations" ? (
          <AccreditationRelations
            disabled={disabled}
            rows={draft.accreditations ?? []}
            getLabel={(id) => getLabel("accreditations", id)}
            onChange={(index, field, value) =>
              onUpdateDraft((current) => ({
                ...current,
                accreditations: (current.accreditations ?? []).map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, [field]: value || null } : entry
                )
              }))
            }
            onRemove={(index) =>
              onUpdateDraft((current) => ({
                ...current,
                accreditations: (current.accreditations ?? []).filter(
                  (_entry, entryIndex) => entryIndex !== index
                )
              }))
            }
          />
        ) : null}
      </div>
    </section>
  );
}

interface RelationSearchBoxProps {
  disabled: boolean;
  label: string;
  loading: boolean;
  options: OptionsResponse["options"];
  quickCreating: boolean;
  search: string;
  type: RelationSearchKey;
  onAdd: (id: string) => void;
  onQuickCreate: (values: { name: string; casNumber?: string; productName?: string }) => void;
  onSearchChange: (value: string) => void;
}

function RelationSearchBox({
  disabled,
  label,
  loading,
  options,
  quickCreating,
  search,
  type,
  onAdd,
  onQuickCreate,
  onSearchChange
}: RelationSearchBoxProps) {
  const [productName, setProductName] = useState("");
  const trimmedSearch = search.trim();
  const canSearch = trimmedSearch.length >= 2;
  const visibleOptions = canSearch ? options.slice(0, 5) : [];
  const showQuickCreate = canSearch;
  const isProduct = type === "products";
  const inputLabel = isProduct ? "Search or create by CAS number" : `Search or create ${label.toLowerCase()}`;
  const placeholder = isProduct ? "Type a CAS number" : `Type a ${label.toLowerCase()} name`;

  function addFirstOption() {
    if (!canSearch) {
      return;
    }

    if (visibleOptions[0]) {
      onAdd(visibleOptions[0].value);
      return;
    }

    if (trimmedSearch) {
      onQuickCreate({
        name: isProduct ? productName.trim() || trimmedSearch : trimmedSearch,
        casNumber: isProduct ? trimmedSearch : undefined,
        productName: productName.trim() || undefined
      });
      setProductName("");
    }
  }

  return (
    <div className="relation-search">
      <label className="field relation-search-input">
        <span>{inputLabel}</span>
        <input
          aria-label={`Search ${label}`}
          disabled={disabled || quickCreating}
          type="search"
          placeholder={placeholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addFirstOption();
            }
            if (event.key === "Escape") {
              onSearchChange("");
            }
          }}
        />
      </label>

      {canSearch ? (
        <div className="relation-results" role="listbox" aria-label={`${label} matches`}>
          {loading ? <div className="relation-result muted">Searching...</div> : null}
          {!loading && visibleOptions.length > 0
            ? visibleOptions.map((option) => (
                <button
                  key={option.value}
                  className={isProduct ? "relation-result product-search-result" : "relation-result"}
                  disabled={disabled || quickCreating}
                  type="button"
                  onClick={() => onAdd(option.value)}
                >
                  {isProduct ? (
                    <span className="product-search-result-meta">
                      <small>{option.meta?.productId ?? option.value}</small>
                      <strong className="relation-result-main">
                        {option.meta?.casNumber ?? option.label}
                      </strong>
                    </span>
                  ) : (
                    <span>
                      <strong className="relation-result-main">{option.label}</strong>
                    </span>
                  )}
                  <strong>Add</strong>
                </button>
              ))
            : null}
          {!loading && visibleOptions.length === 0 ? (
            <div className="relation-result muted">No existing match.</div>
          ) : null}
        </div>
      ) : null}

      {showQuickCreate ? (
        <div className="quick-create">
          {type === "products" ? (
            <label className="field">
              <span>Product name optional</span>
              <input
                disabled={disabled || quickCreating}
                placeholder="Product name"
                type="text"
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
              />
            </label>
          ) : null}
          <button
            className="ghost-button"
            disabled={disabled || quickCreating}
            type="button"
            onClick={() => {
              onQuickCreate({
                name: isProduct ? productName.trim() || trimmedSearch : trimmedSearch,
                casNumber: isProduct ? trimmedSearch : undefined,
                productName: productName.trim() || undefined
              });
              setProductName("");
            }}
          >
            {quickCreating ? "Creating..." : `Create "${trimmedSearch}"`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChemistryRelations({
  disabled,
  rows,
  getLabel,
  onRemove
}: {
  disabled: boolean;
  rows: NonNullable<FacilityRelationsUpsertRequest["chemistries"]>;
  getLabel: (id: string) => string;
  onRemove: (index: number) => void;
}) {
  if (rows.length === 0) {
    return <div className="relation-empty">No chemistries linked yet.</div>;
  }

  return (
    <div className="relation-chip-grid">
      {rows.map((row, index) => (
        <div className="relation-chip" key={`${row.chemistryId}-${index}`}>
          <span>{getLabel(row.chemistryId)}</span>
          <button
            aria-label={`Remove ${getLabel(row.chemistryId)}`}
            className="danger-pill"
            disabled={disabled}
            type="button"
            onClick={() => onRemove(index)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function ProductRelations({
  disabled,
  rows,
  getOption,
  getLabel,
  onPrimaryChange,
  onRemove
}: {
  disabled: boolean;
  rows: NonNullable<FacilityRelationsUpsertRequest["products"]>;
  getOption: (id: string) => OptionsResponse["options"][number] | null;
  getLabel: (id: string) => string;
  onPrimaryChange: (index: number, isPrimary: boolean) => void;
  onRemove: (index: number) => void;
}) {
  if (rows.length === 0) {
    return <div className="relation-empty">No products linked yet.</div>;
  }

  return (
    <div className="relation-row-list">
      {rows.map((row, index) => {
        const option = getOption(row.productId);
        const casNumber = option?.meta?.casNumber ?? getLabel(row.productId);
        const productId = option?.meta?.productId ?? row.productId;
        const productName = option?.meta?.productName;

        return (
          <div className="relation-row product-relation-row" key={`${row.productId}-${index}`}>
            <div className="product-relation-main">
              <strong>{casNumber}</strong>
              <div className="product-relation-meta">
                <span>{productId}</span>
                {productName ? <small>{productName}</small> : null}
              </div>
            </div>

            <div className="product-relation-actions">
              <label className={row.isPrimary ? "primary-toggle active" : "primary-toggle"}>
                <input
                  checked={row.isPrimary}
                  disabled={disabled}
                  type="checkbox"
                  onChange={(event) => onPrimaryChange(index, event.target.checked)}
                />
                <span>Primary</span>
              </label>
              <button
                aria-label={`Remove ${casNumber}`}
                className="danger-pill"
                disabled={disabled}
                type="button"
                onClick={() => onRemove(index)}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AccreditationRelations({
  disabled,
  rows,
  getLabel,
  onChange,
  onRemove
}: {
  disabled: boolean;
  rows: NonNullable<FacilityRelationsUpsertRequest["accreditations"]>;
  getLabel: (id: string) => string;
  onChange: (
    index: number,
    field: "awardingBody" | "certificateNumber" | "awardedAt" | "expiresAt",
    value: string
  ) => void;
  onRemove: (index: number) => void;
}) {
  if (rows.length === 0) {
    return <div className="relation-empty">No accreditations linked yet.</div>;
  }

  return (
    <div className="relation-row-list">
      {rows.map((row, index) => (
        <div className="relation-row accreditation-relation-row" key={`${row.accreditationId}-${index}`}>
          <div className="relation-row-title">
            <strong>{getLabel(row.accreditationId)}</strong>
            <button
              aria-label={`Remove ${getLabel(row.accreditationId)}`}
              className="danger-pill"
              disabled={disabled}
              type="button"
              onClick={() => onRemove(index)}
            >
              Remove
            </button>
          </div>

          <div className="accreditation-fields">
            <label className="field">
              <span>Awarding body</span>
              <input
                disabled={disabled}
                type="text"
                value={row.awardingBody ?? ""}
                onChange={(event) => onChange(index, "awardingBody", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Certificate #</span>
              <input
                disabled={disabled}
                type="text"
                value={row.certificateNumber ?? ""}
                onChange={(event) => onChange(index, "certificateNumber", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Awarded at</span>
              <input
                disabled={disabled}
                type="date"
                value={row.awardedAt ?? ""}
                onChange={(event) => onChange(index, "awardedAt", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Expires at</span>
              <input
                disabled={disabled}
                type="date"
                value={row.expiresAt ?? ""}
                onChange={(event) => onChange(index, "expiresAt", event.target.value)}
              />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderFieldInput(
  column: ColumnMeta,
  value: string,
  disabled: boolean,
  onChange: (value: string) => void
) {
  if (column.kind === "boolean") {
    return (
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (column.kind === "date") {
    return (
      <input
        disabled={disabled}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (column.kind === "timestamp") {
    return (
      <input
        disabled={disabled}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (column.kind === "number") {
    return (
      <input
        disabled={disabled}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      disabled={disabled}
      placeholder={`Enter ${column.label.toLowerCase()}`}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function createEmptyForm(table: TableMeta): FormState {
  return Object.fromEntries(
    table.columns
      .filter((column) => !column.readOnly && !column.hidden && !column.autoGenerated)
      .map((column) => [column.name, ""])
  );
}

function createFormFromColumns(columns: ColumnMeta[], row: RowRecord): FormState {
  const entries = columns.map((column) => [column.name, stringifyFormValue(column, row[column.name])]);
  return Object.fromEntries(entries);
}

function createFormFromRow(table: TableMeta, row: RowRecord): FormState {
  return createFormFromColumns(
    table.columns.filter((column) =>
      table.readOnly ? !column.hidden : !column.readOnly && !column.hidden && !column.autoGenerated
    ),
    row
  );
}

function stringifyFormValue(column: ColumnMeta, value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (column.kind === "timestamp") {
    return toDateTimeLocalValue(String(value));
  }

  if (column.kind === "date") {
    return String(value).slice(0, 10);
  }

  return String(value);
}

function buildPayload(table: TableMeta, formState: FormState, editor: EditorState): RowRecord {
  const payload: RowRecord = {};

  if (editor.mode === "edit" && editor.row) {
    for (const primaryKey of table.primaryKeys) {
      payload[primaryKey] = editor.row[primaryKey];
    }
  }

  for (const column of table.columns) {
    if (column.hidden || column.readOnly || column.autoGenerated) {
      continue;
    }

    const value = formState[column.name];

    if (value === undefined) {
      continue;
    }

    payload[column.name] = value;
  }

  return payload;
}

function buildRowFromForm(columns: ColumnMeta[], formState: FormState): RowRecord {
  const row: RowRecord = {};

  for (const column of columns) {
    row[column.name] = formState[column.name] ?? "";
  }

  return row;
}

function getImportHeaderName(column: ColumnMeta | string): string {
  return typeof column === "string" ? column : (column.importHeader ?? column.name);
}

function normalizeImportedRow(table: TableMeta, row: RowRecord): RowRecord {
  const normalized: RowRecord = {};
  const columnMap = new Map<string, string>();

  for (const column of table.columns) {
    columnMap.set(column.name, column.name);
    columnMap.set(getImportHeaderName(column), column.name);
  }

  for (const [header, value] of Object.entries(row)) {
    const normalizedHeader = columnMap.get(header.trim());
    normalized[normalizedHeader ?? header.trim()] = value;
  }

  return normalized;
}

function getExportCellValue(column: ColumnMeta, row: RowRecord, lookups: LookupCache): unknown {
  const value = row[column.name];

  if (value === undefined || value === null) {
    return "";
  }

  if (column.foreignKey) {
    const options = lookups[column.foreignKey.referencesTable] ?? [];
    const match = options.find((option) => option.value === String(value));
    return match?.label ?? value;
  }

  return value;
}

function getRowTitle(table: TableMeta, row: RowRecord, lookups: LookupCache) {
  const displayColumn = table.columns.find((column) => column.name === table.displayColumn);

  if (displayColumn) {
    const displayValue = formatColumnValue(displayColumn, row[displayColumn.name], lookups);
    if (displayValue !== "—") {
      return displayValue;
    }
  }

  const firstReadable = table.columns.find(
    (column) => !column.hidden && !column.autoGenerated && !column.readOnly
  );

  if (firstReadable) {
    return formatColumnValue(firstReadable, row[firstReadable.name], lookups);
  }

  return `${table.label} entry`;
}

function formatColumnValue(column: ColumnMeta, value: unknown, lookups: LookupCache): string {
  if (column.foreignKey) {
    const options = lookups[column.foreignKey.referencesTable] ?? [];
    const match = options.find((option) => option.value === String(value ?? ""));
    if (match) {
      return match.label;
    }
  }

  if (value === undefined || value === null || value === "") {
    return "—";
  }

  if (column.kind === "boolean") {
    return value ? "Yes" : "No";
  }

  if (column.kind === "date" || column.kind === "timestamp") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }

  return formatCellValue(value);
}

function formatCellValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "—";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function createRowKey(table: TableMeta, row: RowRecord, index: number) {
  const key = table.primaryKeys.map((column) => String(row[column] ?? "")).join("|");
  return key || `${table.name}-${index}`;
}

async function fetchRecordsForExport(tableName: string, search: string): Promise<RowRecord[]> {
  const rows: RowRecord[] = [];
  const limit = EXPORT_PAGE_SIZE;
  let offset = 0;

  while (true) {
    const data = await api<RecordsResponse>(
      `/api/records/${tableName}?limit=${limit}&offset=${offset}&search=${encodeURIComponent(search)}&view=export`
    );
    rows.push(...data.records);
    offset += data.records.length;
    if (offset >= data.total || data.records.length === 0) {
      break;
    }
  }

  return rows;
}

function createExportFilename(tableName: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${tableName}-${stamp}.xlsx`;
}

function mergeOptions(
  existing: OptionsResponse["options"],
  incoming: OptionsResponse["options"]
): OptionsResponse["options"] {
  const byValue = new Map(existing.map((option) => [option.value, option]));
  for (const option of incoming) {
    byValue.set(option.value, option);
  }

  return [...byValue.values()];
}

function buildQuickCreatePayload(key: RelationSearchKey, name: string, casNumber?: string): RowRecord {
  if (key === "chemistries") {
    return {
      label: name,
      slug: slugifyValue(name)
    };
  }

  if (key === "accreditations") {
    return {
      label: name,
      code: slugifyValue(name).toUpperCase()
    };
  }

  return {
    product_name: name,
    cas_number: casNumber?.trim() || name
  };
}

function getRelationSingularLabel(key: RelationSearchKey) {
  if (key === "chemistries") {
    return "Chemistry";
  }

  if (key === "accreditations") {
    return "Accreditation";
  }

  return "Product";
}

function slugifyValue(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `item-${Date.now()}`;
}

function navigateWorkspace(id: string, setActiveView: (value: string) => void) {
  const hash = `#/${id}`;
  if (window.location.hash !== hash) {
    window.history.pushState(null, "", hash);
  }
  setActiveView(id);
}

function readWorkspaceHash() {
  const value = window.location.hash.replace(/^#\/?/, "");
  return value || "overview";
}
