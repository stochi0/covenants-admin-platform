import type { ColumnMeta, TableMeta } from "../../shared/types";

type RowRecord = Record<string, unknown>;
type LookupCache = Record<string, Array<{ value: string; label: string }>>;

export function DataTable({
  columns,
  createRowKey,
  formatColumnValue,
  loading,
  lookups,
  onDelete,
  onEdit,
  page,
  pageCount,
  records,
  setPage,
  table
}: {
  columns: ColumnMeta[];
  createRowKey: (table: TableMeta, row: RowRecord, index: number) => string;
  formatColumnValue: (column: ColumnMeta, value: unknown, lookups: LookupCache) => string;
  loading: boolean;
  lookups: LookupCache;
  onDelete: (row: RowRecord) => void;
  onEdit: (row: RowRecord) => void;
  page: number;
  pageCount: number;
  records: RowRecord[];
  setPage: (updater: (value: number) => number) => void;
  table: TableMeta;
}) {
  return (
    <section className="panel table-panel" aria-busy={loading}>
      <div className="table-meta">
        <span>
          Page {page + 1} of {pageCount}
        </span>
        <span className={loading ? "table-loading-status active" : "table-loading-status"}>
          {loading ? "Loading entries..." : `${records.length} entries loaded`}
        </span>
      </div>

      <div className="table-scroller">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.name} scope="col">
                  {column.label}
                </th>
              ))}
              <th className="actions-column" scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1}>
                  <div className="empty-state">No entries matched the current query.</div>
                </td>
              </tr>
            ) : (
              records.map((row, index) => (
                <tr key={createRowKey(table, row, index)}>
                  {columns.map((column) => (
                    <td key={column.name}>{formatColumnValue(column, row[column.name], lookups)}</td>
                  ))}
                  <td className="actions-cell">
                    <div className="row-actions">
                      {table.readOnly ? (
                        <button onClick={() => onEdit(row)} type="button">
                          View
                        </button>
                      ) : (
                        <>
                          <button onClick={() => onEdit(row)} type="button">
                            Edit
                          </button>
                          <button className="danger-link" onClick={() => onDelete(row)} type="button">
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)} type="button">
          Previous
        </button>
        <button
          disabled={page + 1 >= pageCount || loading}
          onClick={() => setPage((value) => value + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </section>
  );
}
