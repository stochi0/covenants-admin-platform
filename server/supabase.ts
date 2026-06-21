import { Pool, type QueryResultRow } from "pg";

type DbError = { message: string };
type QueryResult<T> = { data: T[] | null; error: DbError | null; count?: number | null };
type MutationResult<T> = { data: T | T[] | null; error: DbError | null; count?: number | null };
type FilterOperator = "=" | "ilike" | "in" | "is" | "not_is";

interface Filter {
  column: string;
  operator: FilterOperator;
  value: unknown;
}

interface OrderSpec {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

let pool: Pool | null = null;

function normalizeDatabaseUrl(url: string): string {
  return url.replace(/^postgres:\/\//, "postgresql://");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getPool(): Pool {
  if (!pool) {
    const url = process.env.SUPABASE_DB_URL;
    if (!url) {
      throw new Error("Set SUPABASE_DB_URL for backend database access.");
    }

    pool = new Pool({
      connectionString: normalizeDatabaseUrl(url),
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
      max: parsePositiveInt(process.env.PG_POOL_MAX, 2),
      connectionTimeoutMillis: parsePositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 5000),
      idleTimeoutMillis: parsePositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 10000),
      allowExitOnIdle: true
    });
  }

  return pool;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function selectList(columns: string): string {
  if (columns.trim() === "*") {
    return "*";
  }

  return columns
    .split(",")
    .map((column) => quoteIdentifier(column.trim()))
    .join(", ");
}

function toDbError(error: unknown): DbError {
  return { message: error instanceof Error ? error.message : "Database request failed." };
}

function addWhereClause(
  clauses: string[],
  params: unknown[],
  filter: Filter,
  startIndex: number
): number {
  const column = quoteIdentifier(filter.column);

  if (filter.operator === "is") {
    clauses.push(`${column} is ${filter.value === null ? "null" : "not null"}`);
    return startIndex;
  }

  if (filter.operator === "not_is") {
    clauses.push(`${column} is not ${filter.value === null ? "null" : "not null"}`);
    return startIndex;
  }

  if (filter.operator === "in") {
    const values = Array.isArray(filter.value) ? filter.value : [];
    if (values.length === 0) {
      clauses.push("false");
      return startIndex;
    }

    const placeholders = values.map((value, index) => {
      params.push(value);
      return `$${startIndex + index}`;
    });
    clauses.push(`${column} in (${placeholders.join(", ")})`);
    return startIndex + values.length;
  }

  params.push(filter.value);
  clauses.push(filter.operator === "ilike" ? `${column} ilike $${startIndex}` : `${column} = $${startIndex}`);
  return startIndex + 1;
}

function parsePostgrestValue(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function parseOrFilter(filter: string): Filter | null {
  const match = filter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(ilike|eq|in)\.(.*)$/);
  if (!match) {
    return null;
  }

  const [, column, operator, rawValue] = match;
  if (!column || !operator || rawValue === undefined) {
    return null;
  }

  if (operator === "in") {
    const values = rawValue.replace(/^\(/, "").replace(/\)$/, "").split(",").filter(Boolean);
    return { column, operator: "in", value: values };
  }

  return {
    column,
    operator: operator === "ilike" ? "ilike" : "=",
    value: parsePostgrestValue(rawValue)
  };
}

function buildWhere(filters: Filter[], orGroups: Filter[][]): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let nextParam = 1;

  for (const filter of filters) {
    nextParam = addWhereClause(clauses, params, filter, nextParam);
  }

  for (const group of orGroups) {
    const groupClauses: string[] = [];
    for (const filter of group) {
      nextParam = addWhereClause(groupClauses, params, filter, nextParam);
    }
    if (groupClauses.length > 0) {
      clauses.push(`(${groupClauses.join(" or ")})`);
    }
  }

  return {
    sql: clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "",
    params
  };
}

class PgQueryBuilder<T extends QueryResultRow = QueryResultRow> implements PromiseLike<any> {
  private readonly filters: Filter[] = [];
  private readonly orGroups: Filter[][] = [];
  private readonly orders: OrderSpec[] = [];
  private selectedColumns = "*";
  private countExact = false;
  private limitCount: number | null = null;
  private offsetCount: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(
    private readonly table: string,
    private readonly action: "select" | "insert" | "update" | "delete",
    private readonly payload?: Record<string, unknown> | Array<Record<string, unknown>>
  ) {}

  select(columns = "*", options?: { count?: "exact" }): this {
    this.selectedColumns = columns;
    this.countExact = options?.count === "exact";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, operator: "=", value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ column, operator: "is", value });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator !== "is") {
      throw new Error(`Unsupported not operator: ${operator}`);
    }
    this.filters.push({ column, operator: "not_is", value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, operator: "in", value: values });
    return this;
  }

  ilike(column: string, value: string): this {
    this.filters.push({ column, operator: "ilike", value });
    return this;
  }

  or(filterExpression: string): this {
    const group = filterExpression
      .split(",")
      .map((filter) => parseOrFilter(filter))
      .filter((filter): filter is Filter => Boolean(filter));

    if (group.length > 0) {
      this.orGroups.push(group);
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst
    });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetCount = from;
    this.limitCount = Math.max(0, to - from + 1);
    return this;
  }

  single(): Promise<any> {
    this.singleMode = "single";
    return this.execute();
  }

  maybeSingle(): Promise<any> {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult<T> | MutationResult<T>> {
    try {
      if (this.action === "select") return await this.executeSelect();
      if (this.action === "insert") return await this.executeInsert();
      if (this.action === "update") return await this.executeUpdate();
      return await this.executeDelete();
    } catch (error) {
      return { data: null, error: toDbError(error), count: null };
    }
  }

  private async executeSelect(): Promise<QueryResult<T> | MutationResult<T>> {
    const table = quoteIdentifier(this.table);
    const where = buildWhere(this.filters, this.orGroups);
    const orderSql =
      this.orders.length > 0
        ? ` order by ${this.orders
            .map((order) => {
              const nulls = order.nullsFirst === undefined ? "" : order.nullsFirst ? " nulls first" : " nulls last";
              return `${quoteIdentifier(order.column)} ${order.ascending ? "asc" : "desc"}${nulls}`;
            })
            .join(", ")}`
        : "";
    const limitSql = this.limitCount === null ? "" : ` limit ${this.limitCount}`;
    const offsetSql = this.offsetCount === null ? "" : ` offset ${this.offsetCount}`;
    const sql = `select ${selectList(this.selectedColumns)} from ${table}${where.sql}${orderSql}${limitSql}${offsetSql}`;
    const rows = (await getPool().query<T>(sql, where.params)).rows;
    const count = this.countExact ? await this.executeCount(where) : null;

    if (this.singleMode) {
      return this.toSingleResult(rows, count);
    }

    return { data: rows, error: null, count };
  }

  private async executeCount(where: { sql: string; params: unknown[] }): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      `select count(*)::text as count from ${quoteIdentifier(this.table)}${where.sql}`,
      where.params
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async executeInsert(): Promise<MutationResult<T>> {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    if (rows.length === 0) {
      return { data: [], error: null };
    }

    const columns = Object.keys(rows[0] ?? {});
    if (columns.length === 0) {
      throw new Error("Insert payload cannot be empty.");
    }

    const params: unknown[] = [];
    const valueGroups = rows.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(row[column]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const sql = `insert into ${quoteIdentifier(this.table)} (${columns
      .map(quoteIdentifier)
      .join(", ")}) values ${valueGroups.join(", ")} returning ${selectList(this.selectedColumns)}`;
    const result = await getPool().query<T>(sql, params);
    return this.singleMode ? this.toSingleResult(result.rows, null) : { data: result.rows, error: null };
  }

  private async executeUpdate(): Promise<MutationResult<T>> {
    const payload = Array.isArray(this.payload) ? this.payload[0] : this.payload ?? {};
    const columns = Object.keys(payload);
    if (columns.length === 0) {
      throw new Error("Update payload cannot be empty.");
    }

    const params: unknown[] = [];
    const setSql = columns
      .map((column) => {
        params.push(payload[column]);
        return `${quoteIdentifier(column)} = $${params.length}`;
      })
      .join(", ");
    const where = buildWhere(this.filters, this.orGroups);
    const sql = `update ${quoteIdentifier(this.table)} set ${setSql}${renumberWhere(where, params.length)} returning ${selectList(
      this.selectedColumns
    )}`;
    const result = await getPool().query<T>(sql, [...params, ...where.params]);
    return this.singleMode ? this.toSingleResult(result.rows, null) : { data: result.rows, error: null };
  }

  private async executeDelete(): Promise<MutationResult<T>> {
    const where = buildWhere(this.filters, this.orGroups);
    const sql = `delete from ${quoteIdentifier(this.table)}${where.sql}`;
    await getPool().query(sql, where.params);
    return { data: null, error: null };
  }

  private toSingleResult(rows: T[], count: number | null): MutationResult<T> {
    if (rows.length === 0 && this.singleMode === "maybeSingle") {
      return { data: null, error: null, count };
    }
    if (rows.length !== 1) {
      return { data: null, error: { message: rows.length === 0 ? "No rows returned." : "Multiple rows returned." }, count };
    }
    return { data: rows[0] ?? null, error: null, count };
  }
}

function renumberWhere(where: { sql: string; params: unknown[] }, offset: number): string {
  if (!where.sql) {
    return "";
  }

  return where.sql.replace(/\$(\d+)/g, (_match, value: string) => `$${Number(value) + offset}`);
}

export const supabase = {
  from(table: string) {
    return {
      select(columns = "*", options?: { count?: "exact" }) {
        return new PgQueryBuilder(table, "select").select(columns, options);
      },
      insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
        return new PgQueryBuilder(table, "insert", payload);
      },
      update(payload: Record<string, unknown>) {
        return new PgQueryBuilder(table, "update", payload);
      },
      delete() {
        return new PgQueryBuilder(table, "delete");
      }
    };
  }
};
