import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import {
  createRecord,
  deleteRecord,
  getFacilityRelations,
  getOptions,
  getTables,
  importRecords,
  listRecords,
  upsertFacilityRelations,
  updateRecord
} from "./data.js";
import { requireAdmin, type AuthenticatedAdminRequest } from "./auth.js";

dotenv.config();

export const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", requireAdmin);

app.get("/api/auth/me", (req: AuthenticatedAdminRequest, res) => {
  res.json({ user: req.admin });
});

app.get("/api/schema", (_req, res) => {
  res.json({ tables: getTables() });
});

app.get("/api/records/:table", async (req, res) => {
  try {
    const limit = clampNumber(req.query.limit, 25, 1, 100);
    const offset = clampNumber(req.query.offset, 0, 0, 10_000);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const data = await listRecords(req.params.table, { limit, offset, search });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/records/:table", async (req, res) => {
  try {
    const data = await createRecord(req.params.table, req.body ?? {});
    res.status(201).json(data);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.patch("/api/records/:table", async (req, res) => {
  try {
    const data = await updateRecord(req.params.table, req.body ?? {});
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.delete("/api/records/:table", async (req, res) => {
  try {
    await deleteRecord(req.params.table, req.body ?? {});
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/import/:table", async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const data = await importRecords(req.params.table, rows);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.get("/api/options/:table", async (req, res) => {
  try {
    const data = await getOptions(req.params.table);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.get("/api/facilities/:id/relations", async (req, res) => {
  try {
    const data = await getFacilityRelations(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.put("/api/facilities/:id/relations", async (req, res) => {
  try {
    const data = await upsertFacilityRelations(req.params.id, req.body ?? {});
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
