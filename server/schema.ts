import { schemaTables } from "../shared/schema-config.js";
import type { TableMeta } from "../shared/types.js";

export function getSchema(): TableMeta[] {
  return schemaTables.filter((table) => !isJoinTable(table));
}

export function getTableOrThrow(tableName: string): TableMeta {
  const table = schemaTables.find((entry) => entry.name === tableName);

  if (!table) {
    throw new Error(`Unknown table "${tableName}".`);
  }

  return table;
}

function isJoinTable(table: TableMeta) {
  if (table.primaryKeys.length < 2) {
    return false;
  }

  const pkColumns = table.columns.filter((column) => column.isPrimaryKey);
  if (pkColumns.length !== table.primaryKeys.length) {
    return false;
  }

  return pkColumns.every((column) => Boolean(column.foreignKey));
}
