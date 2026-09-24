import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  result: {
    data: [{ id: "prod-3849-21-6", cas_number: "3849-21-6" }],
    error: null as null | { code: string; message: string },
    count: 1
  }
}));

vi.mock("./supabase.js", () => ({
  supabase: {
    from(table: string) {
      mock.calls.push(["from", table]);
      const query = {
        select(columns: string) {
          mock.calls.push(["select", columns]);
          return query;
        },
        update(payload: unknown) {
          mock.calls.push(["update", payload]);
          return query;
        },
        delete() {
          mock.calls.push(["delete"]);
          return query;
        },
        is(column: string, value: unknown) {
          mock.calls.push(["is", column, value]);
          return query;
        },
        not(column: string, operator: string, value: unknown) {
          mock.calls.push(["not", column, operator, value]);
          return query;
        },
        eq(column: string, value: unknown) {
          mock.calls.push(["eq", column, value]);
          return query;
        },
        or() {
          return query;
        },
        order() {
          return query;
        },
        range() {
          return Promise.resolve(mock.result);
        },
        single() {
          return Promise.resolve(mock.result);
        }
      };
      return query;
    }
  }
}));

import { deleteRecord, listRecords, restoreRecord, softDeleteRecord } from "./data.js";
import { getSchema } from "./schema.js";

beforeEach(() => {
  mock.calls.length = 0;
  mock.result = { data: [{ id: "prod-3849-21-6", cas_number: "3849-21-6" }], error: null, count: 1 };
});

describe("admin record deletion", () => {
  it("makes every exposed writable table eligible for soft deletion", () => {
    const writable = getSchema().filter((table) => !table.readOnly);
    expect(writable).toHaveLength(7);
    expect(writable.every((table) => table.columns.some((column) => column.name === "deleted_at"))).toBe(
      true
    );
  });

  it("lists the hidden product id needed to delete CAS 3849-21-6", async () => {
    const result = await listRecords("products", { limit: 25, offset: 0, search: "3849-21-6" });
    expect(result.records[0]).toMatchObject({ id: "prod-3849-21-6", cas_number: "3849-21-6" });
    expect(mock.calls.find(([method]) => method === "select")?.[1]).toContain("id");
    expect(mock.calls).toContainEqual(["is", "deleted_at", null]);
  });

  it("soft deletes and restores by primary key in the matching view", async () => {
    await softDeleteRecord("products", { id: "prod-3849-21-6" });
    expect(mock.calls).toContainEqual(["eq", "id", "prod-3849-21-6"]);
    expect(mock.calls).toContainEqual(["is", "deleted_at", null]);
    expect(
      (mock.calls.find(([method]) => method === "update")?.[1] as { deleted_at: string }).deleted_at
    ).toBeTruthy();

    mock.calls.length = 0;
    await restoreRecord("products", { id: "prod-3849-21-6" });
    expect(mock.calls).toContainEqual(["not", "deleted_at", "is", null]);
    expect(mock.calls).toContainEqual(["update", expect.objectContaining({ deleted_at: null })]);
  });

  it("shows only soft deleted records in the Deleted view", async () => {
    await listRecords("products", { limit: 25, offset: 0, status: "deleted" });
    expect(mock.calls).toContainEqual(["not", "deleted_at", "is", null]);
  });

  it("archives a company without changing its linked facilities", async () => {
    await softDeleteRecord("companies", { id: "company-1" });
    expect(mock.calls).toContainEqual(["from", "companies"]);
    expect(mock.calls.some(([method, table]) => method === "from" && table === "facilities")).toBe(false);
  });

  it("does not deactivate an archived CAS control", async () => {
    await softDeleteRecord("controlled_substances", { id: "control-1" });
    expect(mock.calls.find(([method]) => method === "update")?.[1]).not.toHaveProperty("is_active");
  });

  it("permanently deletes an unreferenced row and explains foreign key blockers", async () => {
    await deleteRecord("products", { id: "prod-3849-21-6" });
    expect(mock.calls).toContainEqual(["delete"]);
    expect(mock.calls).toContainEqual(["eq", "id", "prod-3849-21-6"]);

    mock.result = { ...mock.result, error: { code: "23503", message: "foreign key violation" } };
    await expect(deleteRecord("products", { id: "prod-3849-21-6" })).rejects.toThrow(
      "Soft delete it instead"
    );
  });

  it("requires every key for composite-key records", async () => {
    await expect(deleteRecord("facility_products", { facility_id: "facility-1" })).rejects.toThrow(
      'Missing primary key "product_id"'
    );
    await deleteRecord("facility_products", { facility_id: "facility-1", product_id: "prod-3849-21-6" });
    expect(mock.calls).toContainEqual(["eq", "facility_id", "facility-1"]);
    expect(mock.calls).toContainEqual(["eq", "product_id", "prod-3849-21-6"]);
  });
});
