import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  query: vi.fn(),
  rows: [{ id: "PROD-0000003007" }] as Array<{ id: string }>,
  error: null as null | Error
}));

vi.mock("pg", () => ({
  Pool: class {
    query = mock.query;
  }
}));

import { supabase } from "./supabase.js";

beforeEach(() => {
  process.env.SUPABASE_DB_URL = "postgresql://test:test@localhost/test";
  mock.rows = [{ id: "PROD-0000003007" }];
  mock.error = null;
  mock.query.mockReset().mockImplementation(async () => {
    if (mock.error) throw mock.error;
    return { rows: mock.rows };
  });
});

describe("Postgres delete adapter", () => {
  it("returns the deleted primary key so single-row deletion can be checked", async () => {
    const result = await supabase.from("products").delete().select("id").eq("id", "PROD-0000003007").single();
    expect(result).toMatchObject({ data: { id: "PROD-0000003007" }, error: null });
    expect(mock.query.mock.calls[0][0]).toBe('delete from "products" where "id" = $1 returning "id"');
  });

  it("reports when no row matched", async () => {
    mock.rows = [];
    const result = await supabase.from("products").delete().select("id").eq("id", "missing").single();
    expect(result.error?.code).toBe("PGRST116");
  });

  it("keeps bulk link deletion free of returning rows", async () => {
    const result = await supabase.from("facility_products").delete().eq("facility_id", "facility-1");
    expect(result.data).toBeNull();
    expect(mock.query.mock.calls[0][0]).toBe('delete from "facility_products" where "facility_id" = $1');
  });

  it("preserves Postgres foreign key error codes", async () => {
    mock.error = Object.assign(new Error("foreign key violation"), { code: "23503" });
    const result = await supabase.from("products").delete().select("id").eq("id", "PROD-0000003007").single();
    expect(result.error?.code).toBe("23503");
  });
});
