import { beforeEach, describe, expect, it, vi } from "vitest";
import { schemaTables } from "../../../shared/schema-config";

const apiRequest = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../lib/api", () => ({ apiRequest }));

import { runRecordAction } from "./record-actions";

const products = schemaTables.find((table) => table.name === "products")!;
const facilityProducts = schemaTables.find((table) => table.name === "facility_products")!;

beforeEach(() => apiRequest.mockClear());

describe("admin record actions", () => {
  it.each([
    ["delete", "/api/records/products", "DELETE"],
    ["soft-delete", "/api/records/products/soft-delete", "POST"],
    ["restore", "/api/records/products/restore", "POST"]
  ] as const)("sends only the hidden product id for %s", async (action, url, method) => {
    await runRecordAction(products, { id: "PROD-0000003007", cas_number: "3849-21-6" }, action);
    expect(apiRequest).toHaveBeenCalledWith(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "PROD-0000003007" })
    });
  });

  it("sends every key for composite-key rows", async () => {
    await runRecordAction(
      facilityProducts,
      { facility_id: "facility-1", product_id: "PROD-0000003007", is_primary: true },
      "delete"
    );
    expect(apiRequest.mock.calls[0][1].body).toBe(
      JSON.stringify({ facility_id: "facility-1", product_id: "PROD-0000003007" })
    );
  });

  it("rejects a row without its primary key before sending a request", async () => {
    await expect(runRecordAction(products, { cas_number: "3849-21-6" }, "delete")).rejects.toThrow(
      "missing its primary key"
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
