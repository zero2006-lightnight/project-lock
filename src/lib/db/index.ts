import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

function resolveDbFile(): string {
  const raw = process.env.DATABASE_URL ?? "file:./data/studypilot.db";
  if (!raw.startsWith("file:")) {
    throw new Error(
      `Unsupported DATABASE_URL "${raw}". StudyPilot runs on local SQLite (file:...) and is PostgreSQL-ready: point this at Postgres after swapping the driver.`,
    );
  }
  const file = raw.replace(/^file:/, "");
  const absolute = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  return absolute;
}

const globalForDb = globalThis as unknown as { __spDb?: DB; __spMigrated?: boolean };

export function getDb(): DB {
  if (!globalForDb.__spDb) {
    const sqlite = new Database(resolveDbFile());
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // Multi-process access (Next build workers, CI): competing writers wait
    // instead of failing with "database is locked" (first build on an empty
    // DB races migration + demo seeding across workers).
    sqlite.pragma("busy_timeout = 10000");
    globalForDb.__spDb = drizzle(sqlite, { schema });
  }
  if (!globalForDb.__spMigrated) {
    migrate(globalForDb.__spDb, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    globalForDb.__spMigrated = true;
  }
  return globalForDb.__spDb;
}

export { schema };

export const db = getDb();

export function uid(): string {
  return randomUUID();
}
