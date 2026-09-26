import { generateId } from "./utils";
import { openSqlJsDriver, openTauriDriver, type SqlDriver } from "./sql";
import { isTauri } from "./platform";
import { acquireLock, releaseLock } from "./vault";
import { DEFAULT_DOMAINS } from "./domains";
import { mergeDay, slotEntryId } from "./journal";
import { fromDateKey, weekdayIndex } from "./time";
import type { DaySession, Domain, EntryFields, JournalEntry, Slot, WeekSettings } from "./types";

// ─── Connection ───────────────────────────────────────────────────────────────
// The vault is a folder; its data lives in `<vault>/sateach.db` (SQLite).

let db: SqlDriver | null = null;

function conn(): SqlDriver {
  if (!db) throw new Error("Aucun vault ouvert");
  return db;
}

/** Test hook: run the schema on an already-open driver (sql.js in memory). */
export async function attachDriver(driver: SqlDriver): Promise<void> {
  db = driver;
  await migrate(driver);
}

function dbFilePath(vaultPath: string): string {
  // UNC paths (\\server\share) must stay native, otherwise SQLite reads the
  // server name as a URI authority and refuses to open the file.
  if (vaultPath.startsWith("\\\\") || vaultPath.startsWith("//")) {
    return `${vaultPath.replace(/\//g, "\\").replace(/\\+$/, "")}\\sateach.db`;
  }
  return `${vaultPath.replace(/\\/g, "/").replace(/\/+$/, "")}/sateach.db`;
}

export async function openDatabase(vaultPath: string): Promise<void> {
  if (db) await closeDatabase();

  if (!isTauri()) {
    const { default: wasmUrl } = await import("sql.js/dist/sql-wasm.wasm?url");
    db = await openSqlJsDriver({ storageKey: "sateach:demo-db", locateWasm: wasmUrl });
    await migrate(db);
    return;
  }

  await acquireLock(vaultPath);
  const isNetwork = vaultPath.startsWith("\\\\") || vaultPath.startsWith("//");
  const driver = await openTauriDriver(dbFilePath(vaultPath));
  try {
    // WAL needs shared memory that network filesystems don't support.
    try {
      await driver.execute(`PRAGMA journal_mode=${isNetwork ? "DELETE" : "WAL"}`);
    } catch {
      try { await driver.execute("PRAGMA journal_mode=DELETE"); } catch { /* ignore */ }
    }
    await driver.execute("PRAGMA busy_timeout=5000");

    // Detect corruption before touching data, so the app can offer a restore.
    const rows = await driver.select<Record<string, unknown>>("PRAGMA quick_check");
    if (rows.length > 0) {
      const first = String(Object.values(rows[0])[0] ?? "").toLowerCase();
      if (first !== "ok") throw new Error(`Base de données corrompue : ${first.slice(0, 300)}`);
    }

    await migrate(driver);
    db = driver;
  } catch (e) {
    await driver.close();
    await releaseLock();
    throw e;
  }
}

export async function closeDatabase(): Promise<void> {
  const d = db;
  db = null;
  if (d) await d.close();
  await releaseLock();
}

/** Flush the WAL into the main file so a file copy (backup) is consistent. */
export async function checkpointWal(): Promise<void> {
  try { await db?.execute("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* not in WAL mode */ }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const LATEST_SCHEMA_VERSION = 1;

async function migrate(d: SqlDriver): Promise<void> {
  const rows = await d.select<{ user_version: number }>("PRAGMA user_version");
  const version = Number(rows[0]?.user_version ?? 0);

  if (version < 1) {
    await d.execute(`
      CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        target_minutes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute(`
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        day INTEGER NOT NULL,
        start_min INTEGER NOT NULL,
        end_min INTEGER NOT NULL,
        domain_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        slot_id TEXT,
        title TEXT,
        start_min INTEGER,
        end_min INTEGER,
        domain_id TEXT,
        objectives TEXT NOT NULL DEFAULT '',
        progression TEXT NOT NULL DEFAULT '',
        materials TEXT NOT NULL DEFAULT '',
        review TEXT NOT NULL DEFAULT '',
        hidden INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute("CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date)");
    await d.execute(`
      CREATE TABLE IF NOT EXISTS journal_days (
        date TEXT PRIMARY KEY,
        notes TEXT NOT NULL DEFAULT ''
      )`);
    await d.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);

    const existing = await d.select<{ n: number }>("SELECT COUNT(*) AS n FROM domains");
    if (Number(existing[0]?.n ?? 0) === 0) {
      for (const [i, dom] of DEFAULT_DOMAINS.entries()) {
        await d.execute(
          "INSERT INTO domains (id, name, color, position, target_minutes) VALUES (?, ?, ?, ?, ?)",
          [generateId(), dom.name, dom.color, i, dom.target_minutes]
        );
      }
    }
  }

  if (version < LATEST_SCHEMA_VERSION) {
    await d.execute(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`);
  }
}

// ─── Domains ──────────────────────────────────────────────────────────────────

export async function getDomains(): Promise<Domain[]> {
  const rows = await conn().select<Domain>(
    "SELECT id, name, color, position, target_minutes FROM domains ORDER BY position, created_at"
  );
  return rows.map((r) => ({ ...r, position: Number(r.position), target_minutes: Number(r.target_minutes) }));
}

export async function createDomain(name: string, color: string): Promise<string> {
  const id = generateId();
  const rows = await conn().select<{ p: number | null }>("SELECT MAX(position) AS p FROM domains");
  const position = Number(rows[0]?.p ?? -1) + 1;
  await conn().execute(
    "INSERT INTO domains (id, name, color, position, target_minutes) VALUES (?, ?, ?, ?, 0)",
    [id, name, color, position]
  );
  return id;
}

export async function updateDomain(id: string, patch: Partial<Pick<Domain, "name" | "color" | "target_minutes" | "position">>): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  await conn().execute(
    `UPDATE domains SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...keys.map((k) => patch[k]), id]
  );
}

/** Deleting a domain keeps its séances, as "hors domaine". */
export async function deleteDomain(id: string): Promise<void> {
  await conn().execute("UPDATE slots SET domain_id = NULL WHERE domain_id = ?", [id]);
  await conn().execute("UPDATE journal_entries SET domain_id = NULL WHERE domain_id = ?", [id]);
  await conn().execute("DELETE FROM domains WHERE id = ?", [id]);
}

export async function setDomainTargets(targets: { id: string; target_minutes: number }[]): Promise<void> {
  for (const t of targets) {
    await conn().execute("UPDATE domains SET target_minutes = ? WHERE id = ?", [t.target_minutes, t.id]);
  }
}

// ─── Timetable ────────────────────────────────────────────────────────────────

export async function getSlots(): Promise<Slot[]> {
  const rows = await conn().select<Slot>(
    "SELECT id, day, start_min, end_min, domain_id, title FROM slots ORDER BY day, start_min"
  );
  return rows.map((r) => ({ ...r, day: Number(r.day), start_min: Number(r.start_min), end_min: Number(r.end_min) }));
}

export async function createSlot(slot: Omit<Slot, "id">): Promise<string> {
  const id = generateId();
  await conn().execute(
    "INSERT INTO slots (id, day, start_min, end_min, domain_id, title) VALUES (?, ?, ?, ?, ?, ?)",
    [id, slot.day, slot.start_min, slot.end_min, slot.domain_id, slot.title]
  );
  return id;
}

export async function updateSlot(id: string, patch: Partial<Omit<Slot, "id">>): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  await conn().execute(
    `UPDATE slots SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...keys.map((k) => patch[k] ?? null), id]
  );
}

/** Removing a séance from the timetable never loses what was written about it
 *  in the cahier journal: those days keep it as a one-off séance. */
export async function deleteSlot(id: string): Promise<void> {
  const rows = await conn().select<Slot>("SELECT id, day, start_min, end_min, domain_id, title FROM slots WHERE id = ?", [id]);
  const slot = rows[0];
  if (slot) {
    await conn().execute("DELETE FROM journal_entries WHERE slot_id = ? AND hidden = 1", [id]);
    await conn().execute(
      `UPDATE journal_entries SET
         title = COALESCE(title, ?),
         start_min = COALESCE(start_min, ?),
         end_min = COALESCE(end_min, ?),
         domain_id = COALESCE(domain_id, ?),
         slot_id = NULL
       WHERE slot_id = ?`,
      [slot.title, slot.start_min, slot.end_min, slot.domain_id, id]
    );
  }
  await conn().execute("DELETE FROM slots WHERE id = ?", [id]);
}

// ─── Week settings ────────────────────────────────────────────────────────────

export const DEFAULT_WEEK: WeekSettings = { days: [0, 1, 3, 4], dayStart: 8 * 60, dayEnd: 17 * 60 };

export async function getWeekSettings(): Promise<WeekSettings> {
  const rows = await conn().select<{ value: string }>("SELECT value FROM settings WHERE key = 'week'");
  if (!rows[0]) return DEFAULT_WEEK;
  try {
    const v = JSON.parse(rows[0].value) as Partial<WeekSettings>;
    return {
      days: Array.isArray(v.days) ? v.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort() : DEFAULT_WEEK.days,
      dayStart: typeof v.dayStart === "number" ? v.dayStart : DEFAULT_WEEK.dayStart,
      dayEnd: typeof v.dayEnd === "number" ? v.dayEnd : DEFAULT_WEEK.dayEnd,
    };
  } catch {
    return DEFAULT_WEEK;
  }
}

export async function saveWeekSettings(w: WeekSettings): Promise<void> {
  await conn().execute(
    "INSERT INTO settings (key, value) VALUES ('week', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(w)]
  );
}

// ─── Cahier journal ───────────────────────────────────────────────────────────

function toEntry(r: JournalEntry): JournalEntry {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...r, start_min: n(r.start_min), end_min: n(r.end_min), hidden: Number(r.hidden), done: Number(r.done) };
}

export async function getJournalEntries(date: string): Promise<JournalEntry[]> {
  const rows = await conn().select<JournalEntry>("SELECT * FROM journal_entries WHERE date = ?", [date]);
  return rows.map(toEntry);
}

export async function getJournalDay(date: string, slots: Slot[]): Promise<{ sessions: DaySession[]; notes: string }> {
  const entries = await getJournalEntries(date);
  const notesRows = await conn().select<{ notes: string }>("SELECT notes FROM journal_days WHERE date = ?", [date]);
  return {
    sessions: mergeDay(date, weekdayIndex(fromDateKey(date)), slots, entries),
    notes: notesRows[0]?.notes ?? "",
  };
}

const ENTRY_FIELDS: (keyof EntryFields)[] = [
  "title", "start_min", "end_min", "domain_id", "objectives", "progression", "materials", "review", "hidden", "done",
];

/** Write some fields of a séance for one day, creating its journal row on the
 *  first edit (a timetable séance has no row until it is detailed). */
export async function saveSessionFields(date: string, session: Pick<DaySession, "entryId" | "slotId">, patch: EntryFields): Promise<void> {
  const keys = ENTRY_FIELDS.filter((k) => k in patch);
  if (keys.length === 0) return;
  const id = session.slotId ? slotEntryId(session.slotId, date) : session.entryId;
  if (session.slotId) {
    await conn().execute("INSERT OR IGNORE INTO journal_entries (id, date, slot_id) VALUES (?, ?, ?)", [id, date, session.slotId]);
  }
  await conn().execute(
    `UPDATE journal_entries SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...keys.map((k) => patch[k] ?? null), id]
  );
}

export async function createOneOffSession(
  date: string,
  s: { title: string; start_min: number; end_min: number; domain_id: string | null }
): Promise<string> {
  const id = generateId();
  await conn().execute(
    "INSERT INTO journal_entries (id, date, slot_id, title, start_min, end_min, domain_id) VALUES (?, ?, NULL, ?, ?, ?, ?)",
    [id, date, s.title, s.start_min, s.end_min, s.domain_id]
  );
  return id;
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await conn().execute("DELETE FROM journal_entries WHERE id = ?", [id]);
}

export async function saveDayNotes(date: string, notes: string): Promise<void> {
  await conn().execute(
    "INSERT INTO journal_days (date, notes) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET notes = excluded.notes",
    [date, notes]
  );
}

/** Dates (YYYY-MM-DD) between `from` and `to` that have something written. */
export async function getDatesWithContent(from: string, to: string): Promise<Set<string>> {
  const rows = await conn().select<{ date: string }>(
    `SELECT date FROM journal_entries
       WHERE date BETWEEN ? AND ? AND hidden = 0
         AND (objectives <> '' OR progression <> '' OR materials <> '' OR review <> '' OR slot_id IS NULL)
     UNION
     SELECT date FROM journal_days WHERE date BETWEEN ? AND ? AND notes <> ''`,
    [from, to, from, to]
  );
  return new Set(rows.map((r) => r.date));
}
