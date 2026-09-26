import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { getDomains, getSlots, getWeekSettings, DEFAULT_WEEK } from "../lib/db";
import type { Domain, Slot, WeekSettings } from "../lib/types";
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
  week: WeekSettings;
  reload: () => Promise<void>;
  toast: (message: string, type?: "success" | "error") => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVault outside VaultProvider");
  return v;
}

interface Toast { id: number; message: string; type: "success" | "error"; }

export function VaultProvider({ vaultPath, children }: { vaultPath: string; children: ReactNode }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [week, setWeek] = useState<WeekSettings>(DEFAULT_WEEK);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const toastId = useRef(0);

  const reload = useCallback(async () => {
    const [d, s, w] = await Promise.all([getDomains(), getSlots(), getWeekSettings()]);
    setDomains(d);
    setSlots(s);
    setWeek(w);
    setLoaded(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

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
    <Ctx.Provider value={{ vaultPath, loaded, domains, domainById, slots, week, reload, toast, confirm }}>
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
