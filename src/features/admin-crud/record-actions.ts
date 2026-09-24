import type { TableMeta } from "../../../shared/types";
import { apiRequest } from "../../lib/api";

export type RecordAction = "delete" | "soft-delete" | "restore";

export async function runRecordAction(
  table: TableMeta,
  row: Record<string, unknown>,
  action: RecordAction
): Promise<void> {
  const keys = Object.fromEntries(table.primaryKeys.map((key) => [key, row[key]]));
  if (table.primaryKeys.some((key) => keys[key] === undefined || keys[key] === null || keys[key] === "")) {
    throw new Error("This entry is missing its primary key. Refresh and try again.");
  }

  await apiRequest(`/api/records/${table.name}${action === "delete" ? "" : `/${action}`}`, {
    method: action === "delete" ? "DELETE" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(keys)
  });
}
