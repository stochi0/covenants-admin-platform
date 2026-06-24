import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import * as XLSX from "xlsx";
import "dotenv/config";

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required.");
}

const workbookPath = path.resolve(
  process.env.CONTROLLED_SUBSTANCES_WORKBOOK ??
    "../enquiry_system/data/Narcotics.xlsx"
);
if (!fs.existsSync(workbookPath)) {
  throw new Error(`Controlled-substance workbook not found: ${workbookPath}`);
}

const workbook = XLSX.read(fs.readFileSync(workbookPath), { type: "buffer" });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
const records = rows
  .map((row) => {
    const entries = Object.entries(row);
    const read = (pattern) => String(entries.find(([key]) => pattern.test(key))?.[1] ?? "").trim();
    return {
      casNumber: read(/cas/i),
      reason: read(/reason|why/i) || null,
      scometEntry: read(/scomet|entry/i) || null
    };
  })
  .filter((row) => row.casNumber && !["nan", "none"].includes(row.casNumber.toLowerCase()));

const pool = new pg.Pool({
  connectionString: databaseUrl.replace(/^postgres:\/\//, "postgresql://"),
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: 1
});

try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const record of records) {
      await client.query(
        `insert into public.controlled_substances (cas_number, reason, scomet_entry, is_active)
         values ($1, $2, $3, true)
         on conflict (normalized_cas) do update set
           cas_number = excluded.cas_number,
           reason = excluded.reason,
           scomet_entry = excluded.scomet_entry,
           is_active = true`,
        [record.casNumber, record.reason, record.scometEntry]
      );
    }
    await client.query("commit");
    console.log(`Seeded ${records.length} controlled-substance records.`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
