import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, RefreshCw, X } from "lucide-react";
import { isTauri } from "../lib/platform";

// Same flow as Nilo: a silent check a few seconds after launch, then a small
// card offering to download, install and restart.

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; progress: number }
  | { kind: "error"; update: Update }
  | { kind: "done" };

/** Manual check (Settings). null = up to date or offline. */
export async function checkForUpdates(): Promise<Update | null> {
  if (!isTauri()) return null;
  try { return await check(); } catch { return null; }
}

export const UPDATE_EVENT = "sateach:update-available";

export default function UpdateChecker() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const t = setTimeout(async () => {
      const update = await checkForUpdates();
      if (update) setState({ kind: "available", update });
    }, 3000);
    // Settings' "Rechercher" button reuses this card.
    const onFound = (e: Event) => {
      setDismissed(false);
      setState({ kind: "available", update: (e as CustomEvent<Update>).detail });
    };
    window.addEventListener(UPDATE_EVENT, onFound);
    return () => { clearTimeout(t); window.removeEventListener(UPDATE_EVENT, onFound); };
  }, []);

  async function install(update: Update) {
    setState({ kind: "downloading", progress: 0 });
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          downloaded += ev.data.chunkLength;
          if (total > 0) setState({ kind: "downloading", progress: Math.round((downloaded / total) * 100) });
        } else if (ev.event === "Finished") setState({ kind: "done" });
      });
      await relaunch();
    } catch {
      setState({ kind: "error", update });
    }
  }

  if (dismissed || state.kind === "idle") return null;

  const primary = "flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-85";

  return (
    <div className="fixed bottom-5 right-5 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-item-in">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <RefreshCw size={14} className="text-brand-600" />
          Mise à jour disponible
        </div>
        {state.kind !== "downloading" && (
          <button onClick={() => setDismissed(true)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X size={13} />
          </button>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        {state.kind === "available" && (
          <>
            <p className="text-sm text-muted-foreground">
              Sat'each <span className="font-medium text-foreground">{state.update.version}</span> est disponible.
            </p>
            {state.update.body && (
              <div className="max-h-28 overflow-auto whitespace-pre-line rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">{state.update.body}</div>
            )}
            <div className="flex gap-2">
              <button onClick={() => install(state.update)} className={primary}>
                <Download size={12} /> Installer et redémarrer
              </button>
              <button onClick={() => setDismissed(true)} className="flex-1 rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                Plus tard
              </button>
            </div>
          </>
        )}
        {state.kind === "downloading" && (
          <>
            <p className="text-sm text-muted-foreground">Téléchargement… {state.progress} %</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${state.progress}%` }} />
            </div>
          </>
        )}
        {state.kind === "error" && (
          <>
            <p className="text-sm text-muted-foreground">Le téléchargement a échoué. Vérifiez la connexion Internet.</p>
            <button onClick={() => install(state.update)} className={primary + " w-full"}>
              <RefreshCw size={12} /> Réessayer
            </button>
          </>
        )}
        {state.kind === "done" && <p className="text-sm text-muted-foreground">Installé — redémarrage…</p>}
      </div>
    </div>
  );
}
