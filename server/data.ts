import crypto from "node:crypto";

import type {
  AuthStatusResponse,
  FacilityRelationsResponse,
  FacilityRelationsUpsertRequest,
  ImportResponse,
  OptionsResponse,
  RecordsResponse,
  TableMeta
} from "../shared/types.js";
import { getSchema, getTableOrThrow } from "./schema.js";
import { supabase } from "./supabase.js";

type RecordInput = Record<string, unknown>;

export async function listRecords(
  tableName: string,
  options: {
    limit: number;
    offset: number;
    search?: string;
  }
): Promise<RecordsResponse> {
  const table = getTableOrThrow(tableName);
  let query = supabase.from(table.name).select("*", { count: "exact" });

  if (options.search && table.searchableColumns.length > 0) {
    const escaped = escapeForIlike(options.search);
    const filters = table.searchableColumns.map((column) => `${column}.ilike.%${escaped}%`);
    query = query.or(filters.join(","));
  }

  const orderColumn = table.columns.some((column) => column.name === "created_at")
    ? "created_at"
    : table.displayColumn;

  query = query
    .order(orderColumn, { ascending: orderColumn !== "created_at" })
    .range(options.offset, options.offset + options.limit - 1);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return {
    records: data ?? [],
    total: count ?? 0
  };
}

export async function createRecord(
  tableName: string,
  record: RecordInput
): Promise<Record<string, unknown>> {
  const table = getTableOrThrow(tableName);

  if (table.specialHandler === "users") {
    return createUserRecord(record);
  }

  const payload = sanitizeRecord(table, record, "create");
  const { data, error } = await supabase
    .from(table.name)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateRecord(
  tableName: string,
  record: RecordInput
): Promise<Record<string, unknown>> {
  const table = getTableOrThrow(tableName);

  if (table.specialHandler === "users") {
    return updateUserRecord(record);
  }

  const keys = extractPrimaryKeys(table, record);
  const payload = sanitizeRecord(table, record, "update");
  let query = supabase.from(table.name).update(payload).select("*");

  for (const [column, value] of Object.entries(keys)) {
    query = query.eq(column, value as never);
  }

  const { data, error } = await query.single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deleteRecord(tableName: string, record: RecordInput): Promise<void> {
  const table = getTableOrThrow(tableName);

  if (table.specialHandler === "users") {
    await deleteUserRecord(record);
    return;
  }

  const keys = extractPrimaryKeys(table, record);
  let query = supabase.from(table.name).delete();

  for (const [column, value] of Object.entries(keys)) {
    query = query.eq(column, value as never);
  }

  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }
}

export async function importRecords(
  tableName: string,
  rows: RecordInput[]
): Promise<ImportResponse> {
  const table = getTableOrThrow(tableName);
  const filteredRows = rows.filter((row) => !isRowEmpty(row));
  let created = 0;
  let updated = 0;

  if (table.specialHandler === "users") {
    for (const row of filteredRows) {
      const action = await importUserRecord(row);
      if (action === "created") {
        created += 1;
      } else {
        updated += 1;
      }
    }

    return { processed: created + updated, created, updated };
  }

  for (const row of filteredRows) {
    const payload = sanitizeRecord(table, row, "import");

    if (Object.keys(payload).length === 0) {
      continue;
    }

    const existingRecord = await findExistingImportRecord(table, payload);

    if (existingRecord) {
      const mergedRecord = mergeImportedRecord(table, existingRecord, row);
      await updateRecord(table.name, { ...extractPrimaryKeys(table, existingRecord), ...mergedRecord });
      updated += 1;
    } else {
      await createRecord(table.name, payload);
      created += 1;
    }
  }

  return { processed: created + updated, created, updated };
}

export async function getOptions(tableName: string): Promise<OptionsResponse> {
  const table = getTableOrThrow(tableName);
  const primaryKey = table.primaryKeys[0];
  const displayColumn = table.displayColumn;
  const columns = primaryKey === displayColumn ? [primaryKey] : [primaryKey, displayColumn];

  let query = supabase.from(table.name).select(columns.join(",")).limit(200);
  query = query.order(displayColumn, { ascending: true });

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const optionRows = (data ?? []) as unknown as RecordInput[];

  return {
    options: optionRows.map((row) => ({
      value: String(row[primaryKey]),
      label: createOptionLabel(row, primaryKey, displayColumn)
    }))
  };
}

export function getTables() {
  return getSchema();
}

export async function getFacilityRelations(facilityId: string): Promise<FacilityRelationsResponse> {
  const [chemistries, products, accreditations] = await Promise.all([
    supabase
      .from("facility_chemistries")
      .select("chemistry_id")
      .eq("facility_id", facilityId),
    supabase
      .from("facility_products")
      .select("product_id")
      .eq("facility_id", facilityId),
    supabase
      .from("facility_accreditations")
      .select("accreditation_id,awarding_body,certificate_number,awarded_at,expires_at")
      .eq("facility_id", facilityId)
  ]);

  if (chemistries.error) {
    throw new Error(chemistries.error.message);
  }
  if (products.error) {
    throw new Error(products.error.message);
  }
  if (accreditations.error) {
    throw new Error(accreditations.error.message);
  }

  return {
    facilityId,
    chemistryIds: (chemistries.data ?? []).map((row) => String((row as { chemistry_id: unknown }).chemistry_id)),
    productIds: (products.data ?? []).map((row) => String((row as { product_id: unknown }).product_id)),
    accreditations: (accreditations.data ?? []).map((row) => {
      const typed = row as {
        accreditation_id: unknown;
        awarding_body: unknown;
        certificate_number: unknown;
        awarded_at: unknown;
        expires_at: unknown;
      };
      return {
        accreditationId: String(typed.accreditation_id),
        awardingBody: typed.awarding_body === null ? null : String(typed.awarding_body ?? ""),
        certificateNumber: typed.certificate_number === null ? null : String(typed.certificate_number ?? ""),
        awardedAt: typed.awarded_at === null ? null : String(typed.awarded_at ?? ""),
        expiresAt: typed.expires_at === null ? null : String(typed.expires_at ?? "")
      };
    })
  };
}

export async function upsertFacilityRelations(
  facilityId: string,
  payload: FacilityRelationsUpsertRequest
): Promise<FacilityRelationsResponse> {
  if (payload.chemistryIds) {
    const { error: deleteError } = await supabase
      .from("facility_chemistries")
      .delete()
      .eq("facility_id", facilityId);
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const rows = payload.chemistryIds.map((chemistryId) => ({
      facility_id: facilityId,
      chemistry_id: chemistryId
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("facility_chemistries").insert(rows);
      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  }

  if (payload.productIds) {
    const { error: deleteError } = await supabase
      .from("facility_products")
      .delete()
      .eq("facility_id", facilityId);
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const rows = payload.productIds.map((productId) => ({
      facility_id: facilityId,
      product_id: productId
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("facility_products").insert(rows);
      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  }

  if (payload.accreditations) {
    const { error: deleteError } = await supabase
      .from("facility_accreditations")
      .delete()
      .eq("facility_id", facilityId);
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const rows = payload.accreditations.map((accreditation) => ({
      facility_id: facilityId,
      accreditation_id: accreditation.accreditationId,
      awarding_body: accreditation.awardingBody ?? null,
      certificate_number: accreditation.certificateNumber ?? null,
      awarded_at: accreditation.awardedAt ?? null,
      expires_at: accreditation.expiresAt ?? null
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("facility_accreditations").insert(rows);
      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  }

  return getFacilityRelations(facilityId);
}

function sanitizeRecord(
  table: TableMeta,
  record: RecordInput,
  mode: "create" | "update" | "import"
): RecordInput {
  const payload: RecordInput = {};

  for (const column of table.columns) {
    const hasValue = Object.prototype.hasOwnProperty.call(record, column.name);

    if (!hasValue) {
      continue;
    }

    if (column.hidden) {
      continue;
    }

    if (column.autoGenerated) {
      continue;
    }

    if (column.readOnly) {
      continue;
    }

    if (mode === "update" && column.isPrimaryKey) {
      continue;
    }

    const value = normalizeValue(
      record[column.name],
      column.kind,
      column.nullable,
      column.hasDefault
    );

    if (value === undefined) {
      continue;
    }

    payload[column.name] = value;
  }

  if (table.columns.some((column) => column.name === "updated_at")) {
    payload.updated_at = new Date().toISOString();
  }

  return payload;
}

function extractPrimaryKeys(table: TableMeta, record: RecordInput): RecordInput {
  const keys: RecordInput = {};

  for (const column of table.primaryKeys) {
    const value = record[column];

    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing primary key "${column}".`);
    }

    keys[column] = value;
  }

  return keys;
}

function hasPrimaryKeys(table: TableMeta, record: RecordInput): boolean {
  return table.primaryKeys.every((column) => {
    const value = record[column];
    return value !== undefined && value !== null && value !== "";
  });
}

async function findExistingImportRecord(table: TableMeta, record: RecordInput): Promise<RecordInput | null> {
  const matcher = getImportMatcherForRecord(table, record);

  if (!matcher) {
    throw new Error(
      `Import for "${table.label}" requires one of these column sets to identify existing rows: ${formatImportMatchers(
        table
      )}.`
    );
  }

  let query = supabase.from(table.name).select("*").limit(2);

  for (const column of matcher) {
    query = query.eq(column, record[column] as never);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    throw new Error(
      `Import row matched multiple ${table.label.toLowerCase()} records using ${matcher.join(", ")}. Clean up duplicates before importing again.`
    );
  }

  return data[0] as unknown as RecordInput;
}

function getImportMatcherForRecord(table: TableMeta, record: RecordInput): string[] | null {
  const matchers = table.importMatchers?.length ? table.importMatchers : [table.primaryKeys];

  for (const matcher of matchers) {
    if (matcher.every((column) => hasImportValue(record[column]))) {
      return matcher;
    }
  }

  return null;
}

function formatImportMatchers(table: TableMeta): string {
  const matchers = table.importMatchers?.length ? table.importMatchers : [table.primaryKeys];
  return matchers.map((matcher) => matcher.join(" + ")).join(" or ");
}

function hasImportValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function mergeImportedRecord(table: TableMeta, existingRecord: RecordInput, importedRecord: RecordInput): RecordInput {
  const payload: RecordInput = {};

  for (const column of table.columns) {
    if (column.hidden || column.autoGenerated || column.readOnly || column.isPrimaryKey) {
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(importedRecord, column.name)) {
      continue;
    }

    const incomingValue = importedRecord[column.name];
    if (isBlankImportValue(incomingValue)) {
      continue;
    }

    const normalizedValue = normalizeValue(incomingValue, column.kind, column.nullable, column.hasDefault);
    if (normalizedValue === undefined) {
      continue;
    }

    if (column.importBehavior === "merge_email_list") {
      payload[column.name] = mergeEmailListValues(existingRecord[column.name], normalizedValue);
      continue;
    }

    payload[column.name] = normalizedValue;
  }

  if (table.columns.some((column) => column.name === "updated_at")) {
    payload.updated_at = new Date().toISOString();
  }

  return payload;
}

function isBlankImportValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  return typeof value === "string" ? value.trim() === "" : false;
}

function mergeEmailListValues(existingValue: unknown, incomingValue: unknown): string {
  const merged = [...extractEmails(existingValue), ...extractEmails(incomingValue)];
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const email of merged) {
    const normalized = email.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(email);
  }

  return unique.join(", ");
}

function extractEmails(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  const matches = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ?? [];
}

function normalizeValue(
  value: unknown,
  kind: TableMeta["columns"][number]["kind"],
  nullable: boolean,
  hasDefault: boolean
): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === "" || value === null) {
    if (hasDefault) {
      return undefined;
    }

    return nullable ? null : value;
  }

  if (kind === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isNaN(numberValue) ? value : numberValue;
  }

  if (kind === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = String(value).toLowerCase();
    return ["true", "1", "yes"].includes(normalized);
  }

  if (kind === "timestamp") {
    const dateValue = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(dateValue.getTime()) ? value : dateValue.toISOString();
  }

  if (kind === "date") {
    return String(value).slice(0, 10);
  }

  return typeof value === "string" ? value.trim() : value;
}

async function createUserRecord(record: RecordInput) {
  const email = asOptionalString(record.email);
  const fullName = asOptionalString(record.full_name);
  const role = asOptionalString(record.role) ?? "viewer";
  const password = asOptionalString(record.password) ?? createTemporaryPassword();

  if (!email) {
    throw new Error('Users require an "email" value.');
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      ...(fullName ? { full_name: fullName } : {}),
      role
    }
  });

  if (authError) {
    throw new Error(authError.message);
  }

  const payload = {
    id: authData.user.id,
    email,
    full_name: fullName ?? null,
    role,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("users")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function updateUserRecord(record: RecordInput) {
  const id = asOptionalString(record.id);

  if (!id) {
    throw new Error('Users require an "id" value for updates.');
  }

  const email = asOptionalString(record.email);
  const fullName = asOptionalString(record.full_name);
  const role = asOptionalString(record.role);
  const password = asOptionalString(record.password);

  const authPayload: {
    email?: string;
    password?: string;
    user_metadata?: { full_name?: string | null; role?: string };
  } = {};

  if (email) {
    authPayload.email = email;
  }

  if (password) {
    authPayload.password = password;
  }

  if (Object.prototype.hasOwnProperty.call(record, "full_name") || Object.prototype.hasOwnProperty.call(record, "role")) {
    authPayload.user_metadata = {
      ...(Object.prototype.hasOwnProperty.call(record, "full_name") ? { full_name: fullName ?? null } : {}),
      ...(Object.prototype.hasOwnProperty.call(record, "role") ? { role: role ?? "viewer" } : {})
    };
  }

  if (Object.keys(authPayload).length > 0) {
    const { error: authError } = await supabase.auth.admin.updateUserById(id, authPayload);
    if (authError) {
      throw new Error(authError.message);
    }
  }

  const payload: RecordInput = {
    id,
    updated_at: new Date().toISOString()
  };

  if (Object.prototype.hasOwnProperty.call(record, "email")) {
    payload.email = email ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(record, "full_name")) {
    payload.full_name = fullName ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(record, "role")) {
    payload.role = role ?? "viewer";
  }

  const { data, error } = await supabase
    .from("users")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function importUserRecord(record: RecordInput): Promise<"created" | "updated"> {
  const email = asOptionalString(record.email);

  if (!email) {
    throw new Error('Users import requires an "email" value to match existing users.');
  }

  const { data, error } = await supabase.from("users").select("*").ilike("email", email).limit(2);
  if (error) {
    throw new Error(error.message);
  }

  if ((data ?? []).length > 1) {
    throw new Error(`Import row matched multiple users for email "${email}". Clean up duplicates before importing again.`);
  }

  if (data && data.length === 1) {
    const existingUser = data[0] as unknown as RecordInput;
    const mergedUser = mergeImportedUserRecord(existingUser, record);
    await updateUserRecord({ id: existingUser.id, ...mergedUser });
    return "updated";
  }

  await createUserRecord(record);
  return "created";
}

function mergeImportedUserRecord(existingUser: RecordInput, importedRecord: RecordInput): RecordInput {
  const payload: RecordInput = {};

  const fullName = asOptionalString(importedRecord.full_name);
  if (fullName) {
    payload.full_name = fullName;
  }

  const role = asOptionalString(importedRecord.role);
  if (role) {
    payload.role = role;
  }

  const password = asOptionalString(importedRecord.password);
  if (password) {
    payload.password = password;
  }

  const email = asOptionalString(importedRecord.email) ?? asOptionalString(existingUser.email);
  if (email) {
    payload.email = email;
  }

  return payload;
}

async function deleteUserRecord(record: RecordInput) {
  const id = asOptionalString(record.id);

  if (!id) {
    throw new Error('Users require an "id" value for deletes.');
  }

  const { error: profileError } = await supabase.from("users").delete().eq("id", id);
  if (profileError) {
    throw new Error(profileError.message);
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  if (authError) {
    throw new Error(authError.message);
  }
}

function createTemporaryPassword() {
  return `Tmp-${crypto.randomBytes(12).toString("base64url")}9!`;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function createOptionLabel(
  row: Record<string, unknown>,
  primaryKey: string,
  displayColumn: string
): string {
  const displayValue = String(row[displayColumn] ?? "");

  if (displayValue) {
    return displayValue;
  }

  const fallback = String(row[primaryKey] ?? "");
  return fallback ? "Unnamed record" : "Unnamed record";
}

export async function getAuthorizedUserById(id: string): Promise<AuthStatusResponse["user"]> {
  const { data, error } = await supabase
    .from("users")
    .select("id,email,full_name,role")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("You are authenticated, but not authorized to access this admin platform.");
  }

  return {
    id: String(data.id),
    email: data.email ? String(data.email) : null,
    fullName: data.full_name ? String(data.full_name) : null,
    role: data.role ? String(data.role) : "viewer"
  };
}

function escapeForIlike(value: string) {
  return value.replace(/[%_,]/g, "");
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

function isRowEmpty(row: RecordInput): boolean {
  return Object.values(row).every((value) => {
    if (value === undefined || value === null) {
      return true;
    }

    return typeof value === "string" ? value.trim() === "" : false;
  });
}
