// A minimal SQL driver interface with two implementations:
// - Tauri (desktop): tauri-plugin-sql, a real SQLite file inside the vault.
// - Browser (`npm run dev` / tests): sql.js (SQLite compiled to WASM), so the
//   exact same queries run everywhere. In the browser the database is kept in
//   localStorage — it's a demo/dev mode, the real app always uses the vault.

export interface SqlDriver {
  execute(sql: string, params?: unknown[]): Promise<void>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function openTauriDriver(dbFilePath: string): Promise<SqlDriver> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load(`sqlite:${dbFilePath}`);
  return {
    async execute(sql, params = []) {
      await db.execute(sql, params);
    },
    select<T>(sql: string, params: unknown[] = []) {
      return db.select<T[]>(sql, params);
    },
    async close() {
      try { await db.close(); } catch { /* already closed */ }
    },
  };
}

/** sql.js driver. `storageKey` persists the database in localStorage;
 *  `locateWasm` is only needed in the browser (Node finds the file itself). */
export async function openSqlJsDriver(opts: { storageKey?: string; locateWasm?: string } = {}): Promise<SqlDriver> {
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs(opts.locateWasm ? { locateFile: () => opts.locateWasm! } : undefined);

  let initial: Uint8Array | undefined;
  if (opts.storageKey) {
    try {
      const saved = localStorage.getItem(opts.storageKey);
      if (saved) initial = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
    } catch { /* no storage → fresh database */ }
  }
  const db = new SQL.Database(initial);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (!opts.storageKey) return;
    try {
      const bytes = db.export();
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      localStorage.setItem(opts.storageKey, btoa(bin));
    } catch { /* quota / private mode — keep working in memory */ }
  };
  // Never lose the last edits when the tab is closed or reloaded.
  if (opts.storageKey && typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; persist(); }
    });
  }
  const schedulePersist = () => {
    if (!opts.storageKey) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
  };

  return {
    async execute(sql, params = []) {
      db.run(sql, params as never);
      schedulePersist();
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params as never);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async close() {
      if (saveTimer) { clearTimeout(saveTimer); persist(); }
      db.close();
    },
  };
}
