import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

// Thin wrappers around the Rust commands (src-tauri/src/lib.rs). All file work
// happens in Rust. In the browser demo these are no-ops.

export const DEMO_VAULT = "demo";

// ─── Vault lock ───────────────────────────────────────────────────────────────
// A cooperative lock (`.sateach.lock` in the vault) so a vault in a synced
// folder (OneDrive, Drive…) is only edited from one computer at a time.

export interface LockInfo {
  opened_at: number;
  heartbeat_at: number;
  host: string;
  user: string;
  instance: string;
}

export class VaultLockedError extends Error {
  constructor(public readonly info: LockInfo) {
    super("VAULT_LOCKED");
  }
}

const HEARTBEAT_MS = 30_000;
let _lock: { vaultPath: string; instance: string; timer: ReturnType<typeof setInterval> } | null = null;

export async function acquireLock(vaultPath: string): Promise<void> {
  if (!isTauri()) return;
  if (_lock && _lock.vaultPath === vaultPath) return;
  if (_lock) await releaseLock();

  const res = await invoke<{ acquired: boolean; info: LockInfo }>("acquire_vault_lock", { vaultPath });
  if (!res.acquired) throw new VaultLockedError(res.info);

  const instance = res.info.instance;
  const timer = setInterval(async () => {
    try {
      const stillOurs = await invoke<boolean>("refresh_vault_lock", { vaultPath, instance });
      if (!stillOurs) {
        clearInterval(timer);
        if (_lock && _lock.instance === instance) _lock = null;
        window.dispatchEvent(new CustomEvent("sateach:lock-lost"));
      }
    } catch { /* transient FS error — retry next tick */ }
  }, HEARTBEAT_MS);
  _lock = { vaultPath, instance, timer };
}

export async function releaseLock(): Promise<void> {
  if (!_lock) return;
  const { vaultPath, instance, timer } = _lock;
  clearInterval(timer);
  _lock = null;
  try {
    await invoke("release_vault_lock", { vaultPath, instance });
  } catch { /* ignore */ }
}

export async function forceReleaseLock(vaultPath: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("force_release_vault_lock", { vaultPath });
  } catch { /* ignore */ }
}

// ─── Backups ──────────────────────────────────────────────────────────────────

export interface BackupInfo {
  name: string;
  timestamp_ms: number;
  size: number;
}

/** Throttled snapshot (at most every 6h, 10 kept). Never throws. */
export async function autoBackup(vaultPath: string, checkpoint: () => Promise<void>): Promise<void> {
  if (!isTauri()) return;
  try {
    await checkpoint();
    await invoke("backup_vault", { vaultPath });
  } catch (e) {
    console.error("Auto-backup failed:", e);
  }
}

export async function forceBackup(vaultPath: string, checkpoint: () => Promise<void>): Promise<string> {
  if (!isTauri()) return "";
  await checkpoint();
  return invoke<string>("backup_vault", { vaultPath, force: true });
}

export async function listBackups(vaultPath: string): Promise<BackupInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<BackupInfo[]>("list_vault_backups", { vaultPath });
  } catch {
    return [];
  }
}

export async function hasBackups(vaultPath: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("has_backups", { vaultPath });
  } catch {
    return false;
  }
}

export async function restoreLatestBackup(vaultPath: string): Promise<boolean> {
  return invoke<boolean>("restore_latest_backup", { vaultPath });
}
