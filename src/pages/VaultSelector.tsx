import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Clock, Lock, AlertTriangle, FlaskConical } from "lucide-react";
import { getLastVault, saveLastVault } from "../lib/store";
import { openDatabase } from "../lib/db";
import { DEMO_VAULT, VaultLockedError, forceReleaseLock, hasBackups, restoreLatestBackup } from "../lib/vault";
import { isTauri } from "../lib/platform";
import { getVaultName } from "../lib/utils";
import { Button } from "../components/ui/Button";
import logo from "../assets/logo.svg";

interface Props {
  onVaultSelected: (path: string) => void;
}

export default function VaultSelector({ onVaultSelected }: Props) {
  const [lastVault, setLastVault] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<{ path: string; openedAt: number; host: string; user: string } | null>(null);
  const [corrupt, setCorrupt] = useState<{ path: string; error: string } | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    getLastVault().then(setLastVault);
  }, []);

  async function openVault(path: string) {
    setLoading(true);
    setError(null);
    setLocked(null);
    setCorrupt(null);
    try {
      await openDatabase(path);
      await saveLastVault(path);
      onVaultSelected(path);
    } catch (e) {
      if (e instanceof VaultLockedError) {
        setLocked({ path, openedAt: e.info.opened_at, host: e.info.host, user: e.info.user });
      } else if (await hasBackups(path)) {
        setCorrupt({ path, error: String(e) });
      } else {
        setError(`Impossible d'ouvrir le vault : ${e}`);
      }
      setLoading(false);
    }
  }

  async function pickFolder() {
    if (!isTauri()) {
      await openVault(DEMO_VAULT);
      return;
    }
    const selected = await open({ directory: true, multiple: false, title: "Choisir le dossier du vault Sat'each" });
    if (selected && typeof selected === "string") await openVault(selected);
  }

  async function forceOpen() {
    if (!locked) return;
    await forceReleaseLock(locked.path);
    await openVault(locked.path);
  }

  async function restore() {
    if (!corrupt) return;
    setRestoring(true);
    try {
      await restoreLatestBackup(corrupt.path);
      await openVault(corrupt.path);
    } catch {
      setCorrupt(null);
      setError("Échec de la restauration. Choisissez un autre vault.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-background">
      {/* A very soft teal glow — the only decoration of the welcome screen. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-[60%] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 22%, transparent), transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm space-y-8 px-6">
        <div className="flex flex-col items-center text-center">
          <img src={logo} alt="" className="mb-4 h-16 w-16" />
          <h1 className="text-5xl font-bold tracking-tight text-foreground">
            Sat'each
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Emploi du temps & cahier journal</p>
        </div>

        <div className="space-y-3">
          <Button className="w-full gap-2" size="lg" onClick={pickFolder} disabled={loading}>
            {isTauri() ? <FolderOpen size={18} /> : <FlaskConical size={18} />}
            {loading ? "Ouverture…" : isTauri() ? "Ouvrir un vault" : "Ouvrir la démo"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {isTauri() ? (
              <>
                Le vault est un dossier sur votre ordinateur.
                <br />
                Vos données y sont enregistrées (sateach.db).
              </>
            ) : (
              "Mode navigateur : les données restent dans ce navigateur."
            )}
          </p>
        </div>

        {lastVault && isTauri() && (
          <button
            onClick={() => openVault(lastVault)}
            disabled={loading}
            className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Clock size={14} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="font-medium text-foreground">Ouvrir {getVaultName(lastVault)}</div>
              <div className="truncate text-xs text-muted-foreground">{lastVault}</div>
            </div>
          </button>
        )}

        {locked && (
          <div className="space-y-3 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20">
            <div className="flex items-start gap-2">
              <Lock size={14} className="mt-0.5 shrink-0 text-orange-600 dark:text-orange-400" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-300">Vault déjà ouvert</p>
                <p className="text-xs text-orange-700 dark:text-orange-400">
                  Ce vault est ouvert par <span className="font-medium">{locked.user}</span> sur{" "}
                  <span className="font-medium">{locked.host}</span> depuis le{" "}
                  {new Date(locked.openedAt).toLocaleString("fr-FR")}. Ouvrez-le quand même seulement si
                  Sat'each est bien fermé sur l'autre ordinateur.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={forceOpen} disabled={loading} className="flex-1 bg-orange-600 text-white hover:bg-orange-700">
                Ouvrir quand même
              </Button>
              <Button size="sm" variant="outline" onClick={() => setLocked(null)} className="flex-1">Annuler</Button>
            </div>
          </div>
        )}

        {corrupt && (
          <div className="space-y-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Vault illisible</p>
                <p className="text-xs text-red-700 dark:text-red-400">
                  Ce vault est peut-être abîmé. Vous pouvez restaurer la dernière sauvegarde automatique.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={restore} disabled={restoring} className="flex-1 bg-red-600 text-white hover:bg-red-700">
                {restoring ? "Restauration…" : "Restaurer la sauvegarde"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCorrupt(null)} className="flex-1">Annuler</Button>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
