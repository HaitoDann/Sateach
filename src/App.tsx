import { useEffect, useState } from "react";
import { getLastVault, getTheme, saveTheme, applyTheme, clearLastVault, type Theme } from "./lib/store";
import { openDatabase, closeDatabase, checkpointWal } from "./lib/db";
import { autoBackup, hasBackups, restoreLatestBackup, releaseLock, VaultLockedError } from "./lib/vault";
import VaultSelector from "./pages/VaultSelector";
import MainApp from "./pages/MainApp";
import TitleBar from "./components/TitleBar";

type AppState =
  | { status: "loading" }
  | { status: "no-vault" }
  | { status: "recovery"; vaultPath: string; error: string; canRestore: boolean }
  | { status: "ready"; vaultPath: string };

export default function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });
  const [theme, setTheme] = useState<Theme>("light");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    getTheme().then((t) => { setTheme(t); applyTheme(t); });

    const onUnload = () => { void releaseLock(); };
    const onLockLost = () => {
      alert("Ce vault a été ouvert de force sur un autre ordinateur. Fermez Sat'each ici pour éviter d'écraser ses modifications.");
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("sateach:lock-lost", onLockLost);

    getLastVault().then(async (path) => {
      if (!path) { setState({ status: "no-vault" }); return; }
      try {
        await openDatabase(path);
        ready(path);
      } catch (e) {
        if (e instanceof VaultLockedError) { setState({ status: "no-vault" }); return; }
        setState({ status: "recovery", vaultPath: path, error: String(e), canRestore: await hasBackups(path) });
      }
    });

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("sateach:lock-lost", onLockLost);
    };
  }, []);

  function ready(path: string) {
    setState({ status: "ready", vaultPath: path });
    void autoBackup(path, checkpointWal);
  }

  function changeTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
    void saveTheme(t);
  }

  async function changeVault() {
    await closeDatabase();
    await clearLastVault();
    setState({ status: "no-vault" });
  }

  async function restore(path: string) {
    setRestoring(true);
    try {
      await restoreLatestBackup(path);
      await openDatabase(path);
      ready(path);
    } catch {
      setState({ status: "no-vault" });
    } finally {
      setRestoring(false);
    }
  }

  let content;
  if (state.status === "loading") {
    content = <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Chargement…</div>;
  } else if (state.status === "recovery") {
    content = (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-lg font-semibold text-foreground">Le vault n'a pas pu être ouvert</h1>
          <p className="text-sm text-muted-foreground">
            {state.canRestore
              ? "La base de données semble abîmée. Vous pouvez restaurer la dernière sauvegarde automatique."
              : "La base de données semble abîmée et aucune sauvegarde n'est disponible."}
          </p>
          <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">{state.error}</pre>
          <div className="flex items-center justify-center gap-2 pt-1">
            {state.canRestore && (
              <button
                onClick={() => restore(state.vaultPath)}
                disabled={restoring}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {restoring ? "Restauration…" : "Restaurer la sauvegarde"}
              </button>
            )}
            <button
              onClick={() => setState({ status: "no-vault" })}
              disabled={restoring}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Choisir un autre vault
            </button>
          </div>
        </div>
      </div>
    );
  } else if (state.status === "no-vault") {
    content = <VaultSelector onVaultSelected={ready} />;
  } else {
    content = <MainApp vaultPath={state.vaultPath} theme={theme} onTheme={changeTheme} onChangeVault={changeVault} />;
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar />
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  );
}
