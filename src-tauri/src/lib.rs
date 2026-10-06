use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const BACKUP_DIR: &str = ".sateach-backups";
const DB_FILE: &str = "sateach.db";
const KEEP_BACKUPS: usize = 10;
// Don't snapshot more often than this (seconds) so the history spans several
// days instead of being churned by frequent restarts.
const MIN_BACKUP_INTERVAL_SECS: u64 = 6 * 3600;

// ── Vault lock (cooperative, for shared/NAS vaults) ─────────────────────────
const LOCK_FILE: &str = ".sateach.lock";
// A lock whose heartbeat is older than this is considered stale (the owner
// crashed or its machine went offline) and can be taken over.
const LOCK_STALE_MS: u64 = 90_000;

#[derive(Serialize, Deserialize, Clone)]
struct LockInfo {
    opened_at: u64,    // epoch millis when the lock was first taken
    heartbeat_at: u64, // epoch millis of the last heartbeat
    host: String,      // machine name
    user: String,      // OS user name
    instance: String,  // unique per app run, so only the owner refreshes/releases it
}

#[derive(Serialize)]
struct AcquireResult {
    acquired: bool,
    info: LockInfo, // when acquired: ours; otherwise the current owner's
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn machine_user() -> (String, String) {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC inconnu".into());
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "Utilisateur".into());
    (host, user)
}

fn lock_path(vault_path: &str) -> PathBuf {
    Path::new(vault_path).join(LOCK_FILE)
}

fn read_lock(vault_path: &str) -> Option<LockInfo> {
    let s = fs::read_to_string(lock_path(vault_path)).ok()?;
    serde_json::from_str::<LockInfo>(&s).ok()
}

fn write_lock(vault_path: &str, info: &LockInfo) -> Result<(), String> {
    let s = serde_json::to_string(info).map_err(|e| e.to_string())?;
    fs::write(lock_path(vault_path), s).map_err(|e| e.to_string())
}

fn fresh(info: &LockInfo, now: u64) -> bool {
    now.saturating_sub(info.heartbeat_at) < LOCK_STALE_MS
}

/// Try to take the vault lock. If a *fresh* lock from someone else exists, the
/// caller is told who holds it (acquired = false); otherwise we write our own.
#[tauri::command]
fn acquire_vault_lock(vault_path: String) -> Result<AcquireResult, String> {
    let now = now_millis();
    if let Some(existing) = read_lock(&vault_path) {
        if fresh(&existing, now) {
            return Ok(AcquireResult { acquired: false, info: existing });
        }
        // stale → fall through and take over
    }
    let (host, user) = machine_user();
    let info = LockInfo {
        opened_at: now,
        heartbeat_at: now,
        host,
        user,
        instance: format!("{}-{}", std::process::id(), now),
    };
    write_lock(&vault_path, &info)?;
    Ok(AcquireResult { acquired: true, info })
}

/// Keep our lock fresh. Returns false if we no longer own it (someone forced it
/// open from elsewhere) so the UI can warn the user.
#[tauri::command]
fn refresh_vault_lock(vault_path: String, instance: String) -> Result<bool, String> {
    let now = now_millis();
    match read_lock(&vault_path) {
        Some(existing) if existing.instance == instance => {
            let mut updated = existing;
            updated.heartbeat_at = now;
            write_lock(&vault_path, &updated)?;
            Ok(true)
        }
        Some(existing) if fresh(&existing, now) => Ok(false), // taken over by someone else
        _ => {
            // lock missing or stale → reclaim it under our instance
            let (host, user) = machine_user();
            let info = LockInfo { opened_at: now, heartbeat_at: now, host, user, instance };
            write_lock(&vault_path, &info)?;
            Ok(true)
        }
    }
}

/// Release the lock, but only if it is still ours.
#[tauri::command]
fn release_vault_lock(vault_path: String, instance: String) -> Result<(), String> {
    if let Some(existing) = read_lock(&vault_path) {
        if existing.instance == instance {
            let _ = fs::remove_file(lock_path(&vault_path));
        }
    }
    Ok(())
}

/// Forcibly remove the lock (used by the explicit "open anyway" action).
#[tauri::command]
fn force_release_vault_lock(vault_path: String) -> Result<(), String> {
    let _ = fs::remove_file(lock_path(&vault_path));
    Ok(())
}

/// List the vault's backup files (oldest first — names are millisecond stamps).
fn list_backup_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.extension().map(|x| x == "db").unwrap_or(false)
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("sateach-backup-"))
                        .unwrap_or(false)
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    files.sort();
    files
}

fn prune_backups(dir: &Path, keep: usize) {
    let files = list_backup_files(dir);
    if files.len() > keep {
        for old in &files[..files.len() - keep] {
            let _ = fs::remove_file(old);
        }
    }
}

/// Snapshot `<vault>/sateach.db` into `<vault>/.sateach-backups/`, throttled, with rotation.
/// `force` bypasses the throttle (used by the manual "Sauvegarder maintenant").
#[tauri::command]
fn backup_vault(vault_path: String, force: Option<bool>) -> Result<String, String> {
    let vault = Path::new(&vault_path);
    let db = vault.join(DB_FILE);
    if !db.exists() {
        return Err(format!("{} introuvable", DB_FILE));
    }
    let dir = vault.join(BACKUP_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Throttle: skip if the most recent backup is younger than the interval,
    // unless the caller forced it.
    let existing = list_backup_files(&dir);
    if !force.unwrap_or(false) {
        if let Some(latest) = existing.last() {
            if let Ok(modified) = fs::metadata(latest).and_then(|m| m.modified()) {
                if let Ok(age) = SystemTime::now().duration_since(modified) {
                    if age.as_secs() < MIN_BACKUP_INTERVAL_SECS {
                        return Ok("skipped".into());
                    }
                }
            }
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let dest = dir.join(format!("sateach-backup-{}.db", ts));
    fs::copy(&db, &dest).map_err(|e| e.to_string())?;
    prune_backups(&dir, KEEP_BACKUPS);
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn has_backups(vault_path: String) -> Result<bool, String> {
    let dir = Path::new(&vault_path).join(BACKUP_DIR);
    Ok(!list_backup_files(&dir).is_empty())
}

#[derive(Serialize)]
struct BackupInfo {
    name: String,
    timestamp_ms: u64, // parsed from the filename (sateach-backup-<ms>.db)
    size: u64,
}

/// List the vault's automatic backups, newest first, with their date and size
/// (for the Settings "Sauvegardes" panel).
#[tauri::command]
fn list_vault_backups(vault_path: String) -> Result<Vec<BackupInfo>, String> {
    let dir = Path::new(&vault_path).join(BACKUP_DIR);
    let mut out: Vec<BackupInfo> = list_backup_files(&dir)
        .into_iter()
        .map(|p| {
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let timestamp_ms = name
                .strip_prefix("sateach-backup-")
                .and_then(|s| s.strip_suffix(".db"))
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            BackupInfo { name, timestamp_ms, size }
        })
        .collect();
    out.reverse(); // list_backup_files is oldest-first → newest-first for the UI
    Ok(out)
}

/// Restore the most recent backup over `sateach.db` (used for corruption recovery).
#[tauri::command]
fn restore_latest_backup(vault_path: String) -> Result<bool, String> {
    let vault = Path::new(&vault_path);
    let dir = vault.join(BACKUP_DIR);
    let files = list_backup_files(&dir);
    let latest = match files.last() {
        Some(f) => f,
        None => return Ok(false),
    };
    let db = vault.join(DB_FILE);
    // Drop WAL/SHM sidecars so they can't shadow the restored database.
    let _ = fs::remove_file(vault.join(format!("{}-wal", DB_FILE)));
    let _ = fs::remove_file(vault.join(format!("{}-shm", DB_FILE)));
    fs::copy(latest, &db).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Archive files ("Mes cours") ─────────────────────────────────────────────
// Documents attached to an archived course are copied into the vault, under
// `Cours/<domaine>/`, so the vault stays self-contained (and synced).

const ARCHIVE_DIR: &str = "Cours";

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() { "Divers".into() } else { trimmed }
}

/// Copy `source` into `<vault>/Cours/<folder>/` (renaming on collision) and
/// return its path relative to the vault, with forward slashes.
#[tauri::command]
fn import_archive_file(vault_path: String, source: String, folder: String) -> Result<String, String> {
    let src = Path::new(&source);
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("nom de fichier invalide")?;
    let sub = sanitize(&folder);
    let dir = Path::new(&vault_path).join(ARCHIVE_DIR).join(&sub);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("fichier");
    let ext = src.extension().and_then(|s| s.to_str());
    let mut name = sanitize(file_name);
    let mut n = 2;
    while dir.join(&name).exists() {
        name = match ext {
            Some(e) => format!("{} ({}).{}", sanitize(stem), n, e),
            None => format!("{} ({})", sanitize(stem), n),
        };
        n += 1;
    }
    fs::copy(src, dir.join(&name)).map_err(|e| e.to_string())?;
    Ok(format!("{}/{}/{}", ARCHIVE_DIR, sub, name))
}

/// Delete a copied archive file (only inside `<vault>/Cours`).
#[tauri::command]
fn remove_archive_file(vault_path: String, rel_path: String) -> Result<(), String> {
    if !rel_path.starts_with(&format!("{}/", ARCHIVE_DIR)) || rel_path.contains("..") {
        return Err("chemin refusé".into());
    }
    let _ = fs::remove_file(Path::new(&vault_path).join(&rel_path));
    Ok(())
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must be registered first; focus the existing window when a
    // second launch is attempted (prevents two windows on the same vault).
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            backup_vault,
            has_backups,
            list_vault_backups,
            restore_latest_backup,
            acquire_vault_lock,
            refresh_vault_lock,
            release_vault_lock,
            force_release_vault_lock,
            import_archive_file,
            remove_archive_file
        ])
        .setup(|app| {
            // Use an explicit data directory to avoid WebView2 issues on domain accounts
            // where the default path (AppData\Local\com.sateach.app\EBWebView) may be
            // unwritable due to dots in the username or restrictive domain policies.
            let data_dir = app
                .path()
                .local_data_dir()
                .expect("could not resolve local data dir")
                .join("Sateach");

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Sat'each")
                .decorations(false)
                .inner_size(1280.0, 820.0)
                .min_inner_size(1000.0, 640.0)
                // HTML5 drag & drop (domain pastilles) needs the native file-drop
                // handler off, otherwise WebView2 swallows the drag events.
                .disable_drag_drop_handler()
                .data_directory(data_dir)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
