import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import "dotenv/config";

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required.");
}

const pool = new pg.Pool({
  connectionString: databaseUrl.replace(/^postgres:\/\//, "postgresql://"),
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: 1
});

try {
  await pool.query(`
    create table if not exists public.admin_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const migrationDirectory = path.resolve("db/migrations");
  const migrationNames = fs
    .readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const applied = await pool.query("select name from public.admin_schema_migrations");
  const appliedNames = new Set(applied.rows.map((row) => row.name));

  for (const name of migrationNames) {
    if (appliedNames.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(fs.readFileSync(path.join(migrationDirectory, name), "utf8"));
      await client.query("insert into public.admin_schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
