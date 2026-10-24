import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { getDomains, getSlots, getSubjects, getWeekSettings, DEFAULT_WEEK } from "../lib/db";
import type { Domain, Slot, Subject, WeekSettings } from "../lib/types";
import { Dialog } from "../components/ui/Dialog";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/utils";

// Everything the pages share: the vault's domains, timetable and week settings
// (small, loaded once and refreshed after each change), plus toasts and a
// promise-based confirm dialog (native confirm() is unreliable in webviews).

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface VaultContextValue {
  vaultPath: string;
  loaded: boolean;
  domains: Domain[];
  domainById: Map<string, Domain>;
  slots: Slot[];
  /** Dossiers (sous-domaines) of every domain. */
  subjects: Subject[];
  week: WeekSettings;
  reload: () => Promise<void>;
  toast: (message: string, type?: "success" | "error", action?: { label: string; run: () => void }) => void;
  /** Record an action that can be undone (button ↶, Ctrl+Z, or the toast's « Annuler »). */
  pushUndo: (label: string, undo: () => Promise<void>) => void;
  undo: () => Promise<void>;
  undoLabel: string | null;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

/** Fired after an undo so pages reload what they display. */
export const UNDO_EVENT = "sateach:undone";

const Ctx = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVault outside VaultProvider");
  return v;
}

interface Toast { id: number; message: string; type: "success" | "error"; action?: { label: string; run: () => void }; }

export function VaultProvider({ vaultPath, children }: { vaultPath: string; children: ReactNode }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [week, setWeek] = useState<WeekSettings>(DEFAULT_WEEK);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const toastId = useRef(0);

  const reload = useCallback(async () => {
    const [d, s, w, sub] = await Promise.all([getDomains(), getSlots(), getWeekSettings(), getSubjects()]);
    setSubjects(sub);
    setDomains(d);
    setSlots(s);
    setWeek(w);
    setLoaded(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const toast = useCallback((message: string, type: "success" | "error" = "success", action?: { label: string; run: () => void }) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, type, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3000);
  }, []);

  // Undo stack (last 30 actions of this session).
  const undoStack = useRef<{ label: string; undo: () => Promise<void> }[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);

  const undo = useCallback(async () => {
    const last = undoStack.current.pop();
    setToasts((t) => t.filter((x) => !x.action));
    setUndoLabel(undoStack.current[undoStack.current.length - 1]?.label ?? null);
    if (!last) return;
    try {
      await last.undo();
      await reload();
      window.dispatchEvent(new Event(UNDO_EVENT));
      toast(`Annulé : ${last.label}`);
    } catch (e) {
      toast(`Impossible d'annuler : ${e}`, "error");
    }
  }, [toast, reload]);

  const pushUndo = useCallback((label: string, fn: () => Promise<void>) => {
    undoStack.current = [...undoStack.current.slice(-29), { label, undo: fn }];
    setUndoLabel(label);
    toast(label, "success", { label: "Annuler", run: () => void undo() });
  }, [toast, undo]);

  // Ctrl/Cmd+Z outside text fields (inside them, the field's own undo applies).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    []
  );

  function settle(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  const domainById = new Map(domains.map((d) => [d.id, d]));

  return (
    <Ctx.Provider value={{ vaultPath, loaded, domains, domainById, slots, subjects, week, reload, toast, confirm, pushUndo, undo, undoLabel }}>
      {children}

      {pending && (
        <Dialog
          title={pending.title}
          onClose={() => settle(false)}
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => settle(false)}>Annuler</Button>
              <Button
                size="sm"
                variant={pending.destructive ? "destructive" : "default"}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.confirmLabel ?? "Confirmer"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">{pending.message}</p>
        </Dialog>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex min-w-[240px] max-w-sm items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg animate-item-in",
                t.type === "error" ? "bg-destructive text-destructive-foreground" : "bg-foreground text-background"
              )}
            >
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action!.run(); setToasts((all) => all.filter((x) => x.id !== t.id)); }}
                  className="shrink-0 rounded-md bg-background/15 px-2 py-0.5 text-xs font-semibold underline-offset-2 hover:underline"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
                className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}
