import { generateId } from "./utils";
import { openSqlJsDriver, openTauriDriver, type SqlDriver } from "./sql";
import { isTauri } from "./platform";
import { acquireLock, releaseLock } from "./vault";
import { DEFAULT_DOMAINS } from "./domains";
import { mergeDay, slotEntryId } from "./journal";
import { fromDateKey, weekdayIndex } from "./time";
import type { Attachment, AttachmentOwner, Prep, PrepPhase, Sequence, YearSettings, ArchiveFile, ArchiveItem, CalendarEvent, DaySession, Domain, EntryFields, JournalEntry, Slot, WeekSettings } from "./types";

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

const LATEST_SCHEMA_VERSION = 3;

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

  if (version < 2) {
    await d.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'event',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        start_min INTEGER,
        end_min INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        reminder_min INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute("CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date)");
    await d.execute(`
      CREATE TABLE IF NOT EXISTS archive_items (
        id TEXT PRIMARY KEY,
        domain_id TEXT,
        folder TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT '',
        objectives TEXT NOT NULL DEFAULT '',
        progression TEXT NOT NULL DEFAULT '',
        materials TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute(`
      CREATE TABLE IF NOT EXISTS archive_files (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rel_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
  }

  if (version < 3) {
    try { await d.execute("ALTER TABLE journal_entries ADD COLUMN prep_id TEXT"); } catch { /* already there */ }
    await d.execute(`
      CREATE TABLE IF NOT EXISTS sequences (
        id TEXT PRIMARY KEY,
        domain_id TEXT,
        title TEXT NOT NULL,
        levels TEXT NOT NULL DEFAULT '',
        nb_sessions INTEGER,
        general_objectives TEXT NOT NULL DEFAULT '',
        end_of_cycle TEXT NOT NULL DEFAULT '',
        review TEXT NOT NULL DEFAULT '',
        period INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute(`
      CREATE TABLE IF NOT EXISTS preps (
        id TEXT PRIMARY KEY,
        sequence_id TEXT,
        domain_id TEXT,
        title TEXT NOT NULL,
        number INTEGER,
        duration_min INTEGER,
        objective TEXT NOT NULL DEFAULT '',
        skills TEXT NOT NULL DEFAULT '',
        materials TEXT NOT NULL DEFAULT '',
        organisation TEXT NOT NULL DEFAULT '',
        phases TEXT NOT NULL DEFAULT '[]',
        review TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute(`
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rel_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    await d.execute("CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id)");
    await d.execute(`
      CREATE TABLE IF NOT EXISTS programming (
        domain_id TEXT NOT NULL,
        period INTEGER NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (domain_id, period)
      )`);

    // « Mes cours » becomes séquences + fiches de préparation: each archived
    // course turns into a fiche, grouped in a séquence named after its folder.
    // The old tables are left in place, untouched.
    const items = await d.select<ArchiveItem>("SELECT * FROM archive_items");
    const seqIds = new Map<string, string>();
    for (const it of items) {
      let seqId: string | null = null;
      if (it.folder.trim()) {
        const key = `${it.domain_id ?? ""}|${it.folder.trim().toLowerCase()}`;
        seqId = seqIds.get(key) ?? null;
        if (!seqId) {
          seqId = generateId();
          seqIds.set(key, seqId);
          await d.execute("INSERT INTO sequences (id, domain_id, title, levels) VALUES (?, ?, ?, ?)", [seqId, it.domain_id, it.folder.trim(), it.level]);
        }
      }
      const phases = it.progression.trim() ? [{ phase: "", duration: "", materials: "", progression: it.progression, students: "" }] : [];
      await d.execute(
        `INSERT INTO preps (id, sequence_id, domain_id, title, objective, materials, phases, review)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [it.id, seqId, it.domain_id, it.title, it.objectives, it.materials, JSON.stringify(phases), it.notes]
      );
    }
    await d.execute(
      `INSERT INTO attachments (id, owner_type, owner_id, name, rel_path)
         SELECT id, 'prep', item_id, name, rel_path FROM archive_files`
    );
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
  "title", "start_min", "end_min", "domain_id", "objectives", "progression", "materials", "review", "hidden", "done", "prep_id",
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

// ─── Calendar ─────────────────────────────────────────────────────────────────

function toEvent(r: CalendarEvent): CalendarEvent {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...r, start_min: n(r.start_min), end_min: n(r.end_min), reminder_min: n(r.reminder_min) };
}

/** Events overlapping [from, to] (YYYY-MM-DD, inclusive). */
export async function getEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const rows = await conn().select<CalendarEvent>(
    "SELECT * FROM events WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, COALESCE(start_min, -1), title",
    [to, from]
  );
  return rows.map(toEvent);
}

export async function saveEvent(e: Omit<CalendarEvent, "id"> & { id?: string }): Promise<string> {
  const id = e.id ?? generateId();
  await conn().execute(
    `INSERT INTO events (id, title, kind, start_date, end_date, start_min, end_min, notes, reminder_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, kind = excluded.kind, start_date = excluded.start_date,
       end_date = excluded.end_date, start_min = excluded.start_min, end_min = excluded.end_min,
       notes = excluded.notes, reminder_min = excluded.reminder_min`,
    [id, e.title, e.kind, e.start_date, e.end_date, e.start_min, e.end_min, e.notes, e.reminder_min]
  );
  return id;
}

export async function deleteEvent(id: string): Promise<void> {
  await conn().execute("DELETE FROM events WHERE id = ?", [id]);
}

// ─── Archive (mes cours) ──────────────────────────────────────────────────────

export async function getArchiveItems(): Promise<ArchiveItem[]> {
  return conn().select<ArchiveItem>("SELECT * FROM archive_items ORDER BY folder COLLATE NOCASE, title COLLATE NOCASE");
}

export async function saveArchiveItem(item: Omit<ArchiveItem, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<string> {
  const id = item.id ?? generateId();
  await conn().execute(
    `INSERT INTO archive_items (id, domain_id, folder, title, level, objectives, progression, materials, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET domain_id = excluded.domain_id, folder = excluded.folder, title = excluded.title,
       level = excluded.level, objectives = excluded.objectives, progression = excluded.progression,
       materials = excluded.materials, notes = excluded.notes, updated_at = datetime('now')`,
    [id, item.domain_id, item.folder, item.title, item.level, item.objectives, item.progression, item.materials, item.notes]
  );
  return id;
}

export async function deleteArchiveItem(id: string): Promise<ArchiveFile[]> {
  const files = await getArchiveFiles(id);
  await conn().execute("DELETE FROM archive_files WHERE item_id = ?", [id]);
  await conn().execute("DELETE FROM archive_items WHERE id = ?", [id]);
  return files;
}

export async function getArchiveFiles(itemId?: string): Promise<ArchiveFile[]> {
  return itemId
    ? conn().select<ArchiveFile>("SELECT * FROM archive_files WHERE item_id = ? ORDER BY created_at", [itemId])
    : conn().select<ArchiveFile>("SELECT * FROM archive_files ORDER BY created_at");
}

export async function addArchiveFile(itemId: string, name: string, relPath: string): Promise<string> {
  const id = generateId();
  await conn().execute("INSERT INTO archive_files (id, item_id, name, rel_path) VALUES (?, ?, ?, ?)", [id, itemId, name, relPath]);
  return id;
}

export async function deleteArchiveFile(id: string): Promise<void> {
  await conn().execute("DELETE FROM archive_files WHERE id = ?", [id]);
}

/** Raw journal row, for undo snapshots. */
export async function getEntryRow(id: string): Promise<JournalEntry | null> {
  const rows = await conn().select<JournalEntry>("SELECT * FROM journal_entries WHERE id = ?", [id]);
  return rows[0] ? toEntry(rows[0]) : null;
}

/** Put a journal row back exactly as snapshotted (null = it did not exist). */
export async function restoreEntryRow(id: string, row: JournalEntry | null): Promise<void> {
  await conn().execute("DELETE FROM journal_entries WHERE id = ?", [id]);
  if (!row) return;
  await conn().execute(
    `INSERT INTO journal_entries (id, date, slot_id, title, start_min, end_min, domain_id, objectives, progression, materials, review, hidden, done, prep_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.date, row.slot_id, row.title, row.start_min, row.end_min, row.domain_id, row.objectives, row.progression,
     row.materials, row.review, row.hidden, row.done, row.prep_id ?? null]
  );
}

/** Copy a séance (with its details) as a one-off séance on another day. */
export async function copySessionTo(date: string, s: DaySession): Promise<string> {
  const id = generateId();
  await conn().execute(
    `INSERT INTO journal_entries (id, date, slot_id, title, start_min, end_min, domain_id, objectives, progression, materials, review, prep_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, date, s.title, s.start_min, s.end_min, s.domain_id, s.objectives, s.progression, s.materials, s.review, s.prepId]
  );
  return id;
}

/** Replace the whole timetable (timetable undo). */
export async function replaceSlots(slots: Slot[]): Promise<void> {
  await conn().execute("DELETE FROM slots");
  for (const s of slots) {
    await conn().execute(
      "INSERT INTO slots (id, day, start_min, end_min, domain_id, title) VALUES (?, ?, ?, ?, ?, ?)",
      [s.id, s.day, s.start_min, s.end_min, s.domain_id, s.title]
    );
  }
}

// ─── Séquences & fiches de préparation ────────────────────────────────────────

function toPrep(r: Omit<Prep, "phases"> & { phases: string }): Prep {
  let phases: PrepPhase[] = [];
  try { phases = JSON.parse(r.phases) as PrepPhase[]; } catch { /* keep empty */ }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...r, number: n(r.number), duration_min: n(r.duration_min), phases: Array.isArray(phases) ? phases : [] };
}

export async function getPreps(): Promise<Prep[]> {
  const rows = await conn().select<Omit<Prep, "phases"> & { phases: string }>(
    "SELECT * FROM preps ORDER BY COALESCE(number, 9999), title COLLATE NOCASE"
  );
  return rows.map(toPrep);
}

export async function getPrep(id: string): Promise<Prep | null> {
  const rows = await conn().select<Omit<Prep, "phases"> & { phases: string }>("SELECT * FROM preps WHERE id = ?", [id]);
  return rows[0] ? toPrep(rows[0]) : null;
}

export type PrepInput = Omit<Prep, "id" | "updated_at"> & { id?: string };

export async function savePrep(p: PrepInput): Promise<string> {
  const id = p.id ?? generateId();
  await conn().execute(
    `INSERT INTO preps (id, sequence_id, domain_id, title, number, duration_min, objective, skills, materials, organisation, phases, review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET sequence_id = excluded.sequence_id, domain_id = excluded.domain_id, title = excluded.title,
       number = excluded.number, duration_min = excluded.duration_min, objective = excluded.objective, skills = excluded.skills,
       materials = excluded.materials, organisation = excluded.organisation, phases = excluded.phases, review = excluded.review,
       updated_at = datetime('now')`,
    [id, p.sequence_id, p.domain_id, p.title, p.number, p.duration_min, p.objective, p.skills, p.materials, p.organisation,
     JSON.stringify(p.phases), p.review]
  );
  return id;
}

/** Deletes the fiche and unlinks it from the cahier journal. */
export async function deletePrep(id: string): Promise<Attachment[]> {
  // Attachment rows/files are kept so the deletion can be undone.
  const files = await getAttachments("prep", id);
  await conn().execute("UPDATE journal_entries SET prep_id = NULL WHERE prep_id = ?", [id]);
  await conn().execute("DELETE FROM preps WHERE id = ?", [id]);
  return files;
}

export async function getSequences(): Promise<Sequence[]> {
  const rows = await conn().select<Sequence>("SELECT * FROM sequences ORDER BY COALESCE(period, 99), title COLLATE NOCASE");
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({ ...r, nb_sessions: n(r.nb_sessions), period: n(r.period) }));
}

export type SequenceInput = Omit<Sequence, "id" | "updated_at"> & { id?: string };

export async function saveSequence(q: SequenceInput): Promise<string> {
  const id = q.id ?? generateId();
  await conn().execute(
    `INSERT INTO sequences (id, domain_id, title, levels, nb_sessions, general_objectives, end_of_cycle, review, period)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET domain_id = excluded.domain_id, title = excluded.title, levels = excluded.levels,
       nb_sessions = excluded.nb_sessions, general_objectives = excluded.general_objectives, end_of_cycle = excluded.end_of_cycle,
       review = excluded.review, period = excluded.period, updated_at = datetime('now')`,
    [id, q.domain_id, q.title, q.levels, q.nb_sessions, q.general_objectives, q.end_of_cycle, q.review, q.period]
  );
  return id;
}

/** Deletes the séquence; its fiches are kept (without séquence). */
export async function deleteSequence(id: string): Promise<Attachment[]> {
  const files = await getAttachments("sequence", id);
  await conn().execute("UPDATE preps SET sequence_id = NULL WHERE sequence_id = ?", [id]);
  await conn().execute("DELETE FROM sequences WHERE id = ?", [id]);
  return files;
}

// ─── Attachments (images & documents) ────────────────────────────────────────

export async function getAttachments(ownerType: AttachmentOwner, ownerId: string): Promise<Attachment[]> {
  return conn().select<Attachment>(
    "SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY created_at", [ownerType, ownerId]
  );
}

export async function addAttachment(ownerType: AttachmentOwner, ownerId: string, name: string, relPath: string): Promise<string> {
  const id = generateId();
  await conn().execute(
    "INSERT INTO attachments (id, owner_type, owner_id, name, rel_path) VALUES (?, ?, ?, ?, ?)", [id, ownerType, ownerId, name, relPath]
  );
  return id;
}

export async function deleteAttachment(id: string): Promise<void> {
  await conn().execute("DELETE FROM attachments WHERE id = ?", [id]);
}

/** Number of attachments per owner id (for badges). */
export async function countAttachments(ownerType: AttachmentOwner): Promise<Map<string, number>> {
  const rows = await conn().select<{ owner_id: string; n: number }>(
    "SELECT owner_id, COUNT(*) AS n FROM attachments WHERE owner_type = ? GROUP BY owner_id", [ownerType]
  );
  return new Map(rows.map((r) => [r.owner_id, Number(r.n)]));
}

// ─── Programmation annuelle ───────────────────────────────────────────────────

export async function getYearSettings(): Promise<YearSettings | null> {
  const rows = await conn().select<{ value: string }>("SELECT value FROM settings WHERE key = 'year'");
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].value) as YearSettings; } catch { return null; }
}

export async function saveYearSettings(y: YearSettings): Promise<void> {
  await conn().execute(
    "INSERT INTO settings (key, value) VALUES ('year', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(y)]
  );
}

export async function getProgramming(): Promise<Map<string, string>> {
  const rows = await conn().select<{ domain_id: string; period: number; content: string }>("SELECT * FROM programming");
  return new Map(rows.map((r) => [`${r.domain_id}:${Number(r.period)}`, r.content]));
}

export async function saveProgramming(domainId: string, period: number, content: string): Promise<void> {
  await conn().execute(
    `INSERT INTO programming (domain_id, period, content) VALUES (?, ?, ?)
     ON CONFLICT(domain_id, period) DO UPDATE SET content = excluded.content`,
    [domainId, period, content]
  );
}

/** Journal rows attached to a timetable séance (snapshotted before deleting it). */
export async function getEntriesForSlot(slotId: string): Promise<JournalEntry[]> {
  const rows = await conn().select<JournalEntry>("SELECT * FROM journal_entries WHERE slot_id = ?", [slotId]);
  return rows.map(toEntry);
}

/** Days of the cahier journal using a fiche (for « utilisée le … »). */
export async function getPrepUsages(prepId: string): Promise<{ id: string; date: string; done: number }[]> {
  const rows = await conn().select<{ id: string; date: string; done: number }>(
    "SELECT id, date, done FROM journal_entries WHERE prep_id = ? AND hidden <> 2 ORDER BY date", [prepId]
  );
  return rows.map((r) => ({ ...r, done: Number(r.done) }));
}

export async function relinkPrep(prepId: string, entryIds: string[]): Promise<void> {
  for (const id of entryIds) await conn().execute("UPDATE journal_entries SET prep_id = ? WHERE id = ?", [prepId, id]);
}
