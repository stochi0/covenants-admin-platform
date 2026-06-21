import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import { handleClerkWebhook } from "./clerk-webhook.js";
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
import { requireAdmin, verifyClerkHeaders, type AuthenticatedAdminRequest } from "./auth.js";
import { upsertUserProfile } from "./users.js";

dotenv.config();

export const app = express();

app.use(cors());

app.post("/api/clerk/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    await handleClerkWebhook(rawBody, req.headers);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Clerk webhook error:", error);
    res.status(400).json({
      error: "Webhook verification failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/users/sync", async (req, res) => {
  let claims: Awaited<ReturnType<typeof verifyClerkHeaders>>;

  try {
    claims = await verifyClerkHeaders(req.headers);
  } catch (error) {
    res.status(401).json({
      error: "Unauthorized",
      details: error instanceof Error ? error.message : "Authentication failed."
    });
    return;
  }

  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const email = readString(body.email);

  if (!email) {
    res.status(400).json({ error: "Email is required." });
    return;
  }

  try {
    const id = await upsertUserProfile({
      clerkUserId: claims.sub!,
      email,
      firstName: readString(body.firstName),
      lastName: readString(body.lastName),
      imageUrl: readString(body.imageUrl),
      emailVerified: body.emailVerified === true
    });

    res.status(200).json({ id });
  } catch (error) {
    res.status(500).json({
      error: "User sync failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
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
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const limit = clampNumber(req.query.limit, 50, 1, 500);
    const variant = typeof req.query.variant === "string" ? req.query.variant : undefined;
    const ids =
      typeof req.query.ids === "string"
        ? req.query.ids.split(",").map((id) => id.trim()).filter(Boolean)
        : undefined;
    const data = await getOptions(req.params.table, { ids, search, limit, variant });
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

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
