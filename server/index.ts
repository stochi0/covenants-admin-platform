import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";

import {
  createRecord,
  deleteRecord,
  getAuthorizedUserById,
  getFacilityRelations,
  getOptions,
  getTables,
  importRecords,
  listRecords,
  upsertFacilityRelations,
  updateRecord
} from "./data.js";
import { supabase } from "./supabase.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 8787);
const allowedAdminRoles = parseAllowedRoles(process.env.ADMIN_AUTH_ROLES ?? "admin");

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health") {
    next();
    return;
  }

  void authenticateRequest(req, res, next);
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.authUser) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  res.json({ user: req.authUser });
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

const clientDir = path.resolve(process.cwd(), "dist/client");

if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
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

async function authenticateRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: "Your session is invalid or has expired." });
      return;
    }

    req.authUser = await getAuthorizedUserById(user.id);

    if (!allowedAdminRoles.has(req.authUser.role.toLowerCase())) {
      res.status(403).json({ error: "Your account does not have an admin role for this platform." });
      return;
    }

    next();
  } catch (error) {
    res.status(403).json({ error: getErrorMessage(error) });
  }
}

function getBearerToken(req: Request) {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function parseAllowedRoles(value: string) {
  return new Set(
    value
      .split(",")
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean)
  );
}

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email: string | null;
        fullName: string | null;
        role: string;
      };
    }
  }
}
