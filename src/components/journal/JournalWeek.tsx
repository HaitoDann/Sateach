import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy, ClipboardPaste, EyeOff, Maximize2, Sun, Trash2, X } from "lucide-react";
import { useVault } from "../../context/VaultContext";
import { getJournalDay } from "../../lib/db";
import { DAY_NAMES, fmtTime, fromDateKey, weekdayIndex } from "../../lib/time";
import type { DaySession, YearSettings } from "../../lib/types";
import { holidayOn } from "../../lib/year";
import { cn, withAlpha } from "../../lib/utils";
import { RatingDot } from "../common/Rating";

interface Props {
  dates: string[];
  today: string;
  /** Changes after every edit → reload. */
  version: number;
  clip: { date: string; key: string; title: string } | null;
  year: YearSettings | null;
  titleOf: (s: DaySession) => string;
  onOpenDay: (date: string) => void;
  onCopy: (s: DaySession, date: string) => void;
  onPaste: (date: string) => void;
  /** Excel-like fill: copy `s` (from `from`) onto `dates`. */
  onFill: (s: DaySession, from: string, dates: string[]) => void;
  onSetDone: (s: DaySession, date: string, v: number) => void;
  onHide: (s: DaySession, date: string) => void;
  onDelete: (s: DaySession, date: string) => void;
}

type Menu =
  | { kind: "session"; x: number; y: number; s: DaySession; date: string }
  | { kind: "day"; x: number; y: number; date: string };

/** Several days of the cahier journal side by side. Right-click to copy / paste,
 *  drag the small handle of a séance across days to repeat it (like Excel). */
export default function JournalWeek(p: Props) {
  const { slots, domainById } = useVault();
  const [days, setDays] = useState<Map<string, DaySession[]>>(new Map());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [fill, setFill] = useState<{ s: DaySession; from: number; to: number } | null>(null);
  const fillRef = useRef(fill);
  fillRef.current = fill;

  const key = p.dates.join(",");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(p.dates.map(async (d) => [d, (await getJournalDay(d, slots)).sessions] as const)).then((rows) => {
      if (!cancelled) setDays(new Map(rows));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, slots, p.version]);

  function startFill(e: React.PointerEvent, s: DaySession, idx: number) {
    e.preventDefault();
    e.stopPropagation();
    setFill({ s, from: idx, to: idx });
    const move = (ev: PointerEvent) => {
      const col = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("[data-day-idx]");
      if (col && fillRef.current) setFill({ ...fillRef.current, to: Number(col.getAttribute("data-day-idx")) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const f = fillRef.current;
      setFill(null);
      if (!f || f.to === f.from) return;
      const [a, b] = [Math.min(f.from, f.to), Math.max(f.from, f.to)];
      const targets = p.dates.slice(a, b + 1).filter((_, i) => a + i !== f.from);
      p.onFill(f.s, p.dates[f.from], targets);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const inFill = (i: number) => fill && i !== fill.from && i >= Math.min(fill.from, fill.to) && i <= Math.max(fill.from, fill.to);

  return (
    <div className={cn("flex min-h-0 flex-1 gap-2 overflow-x-auto px-4 py-4", fill && "cursor-copy select-none")}>
      {p.dates.map((d, idx) => {
        const list = (days.get(d) ?? []).filter((s) => s.hidden !== 2);
        const holiday = holidayOn(p.year, d);
        const date = fromDateKey(d);
        return (
          <div
            key={d}
            data-day-idx={idx}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: "day", x: e.clientX, y: e.clientY, date: d }); }}
            className={cn(
              "flex min-w-[190px] flex-1 flex-col overflow-hidden rounded-xl border bg-card transition-colors",
              d === p.today ? "border-primary/60" : "border-border",
              inFill(idx) && "border-primary bg-accent/50"
            )}
          >
            <button onClick={() => p.onOpenDay(d)} className="flex items-baseline gap-2 border-b border-border px-3 py-2 text-left hover:bg-muted" title="Ouvrir ce jour">
              <span className={cn("text-sm font-semibold", d === p.today ? "text-brand-700 dark:text-brand-300" : "text-foreground")}>{DAY_NAMES[weekdayIndex(date)]}</span>
              <span className="text-xs text-muted-foreground">{date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
              <Maximize2 size={11} className="ml-auto self-center text-muted-foreground/60" />
            </button>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
              {holiday && (
                <div className="flex items-center gap-1.5 rounded-lg bg-accent px-2 py-1.5 text-xs text-accent-foreground"><Sun size={12} /> {holiday.name}</div>
              )}
              {list.map((s) => {
                const dom = s.domain_id ? domainById.get(s.domain_id) : undefined;
                const masked = s.hidden === 1;
                return (
                  <div
                    key={s.key}
                    onClick={() => p.onOpenDay(d)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: "session", x: e.clientX, y: e.clientY, s, date: d }); }}
                    className={cn(
                      "group relative cursor-pointer rounded-lg border-l-[3px] px-2 py-1.5 text-xs transition-shadow hover:shadow-sm",
                      masked && "opacity-45"
                    )}
                    style={{
                      borderLeftColor: dom?.color ?? "var(--border)",
                      backgroundColor: dom ? withAlpha(dom.color, 0.1) : "var(--muted)",
                    }}
                    title="Clic : ouvrir le jour · clic droit : copier, valider… · poignée : répéter sur d'autres jours"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="tabular-nums text-muted-foreground">{fmtTime(s.start_min)}</span>
                      <span className={cn("min-w-0 flex-1 truncate font-medium text-foreground", masked && "line-through")}>{p.titleOf(s)}</span>
                      <RatingDot value={s.rating} />
                      {s.done === 1 && <Check size={12} className="shrink-0 text-brand-600" strokeWidth={3} />}
                      {s.done === 2 && <X size={12} className="shrink-0 text-destructive" strokeWidth={3} />}
                    </div>
                    {/* Fill handle (Excel-like) */}
                    <span
                      onPointerDown={(e) => startFill(e, s, idx)}
                      onClick={(e) => e.stopPropagation()}
                      title="Glisser vers les autres jours pour répéter cette séance"
                      className="absolute -bottom-1 -right-1 hidden h-3 w-3 cursor-crosshair rounded-sm border-2 border-card bg-primary group-hover:block"
                    />
                  </div>
                );
              })}
              {fill && inFill(idx) && (
                <div className="rounded-lg border-2 border-dashed border-primary px-2 py-1.5 text-xs text-accent-foreground">
                  + {fmtTime(fill.s.start_min)} {p.titleOf(fill.s)}
                </div>
              )}
              {list.length === 0 && !holiday && <p className="px-1 py-3 text-center text-[11px] text-muted-foreground/70">Aucune séance</p>}
              {p.clip && (
                <button onClick={() => p.onPaste(d)} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                  <ClipboardPaste size={11} /> Coller « {p.clip.title} »
                </button>
              )}
            </div>
          </div>
        );
      })}

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 w-60 rounded-lg border border-border bg-card py-1 shadow-xl"
            style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 250)), top: Math.min(menu.y, window.innerHeight - 280) }}
            onClick={() => setMenu(null)}
          >
            {menu.kind === "session" ? (
              <>
                <Item icon={<ClipboardCopy size={14} />} label="Copier" onClick={() => p.onCopy(menu.s, menu.date)} />
                {p.clip && <Item icon={<ClipboardPaste size={14} />} label={`Coller « ${p.clip.title} » ce jour`} onClick={() => p.onPaste(menu.date)} />}
                <Item icon={<Maximize2 size={14} />} label="Ouvrir le jour" onClick={() => p.onOpenDay(menu.date)} />
                <div className="my-1 h-px bg-border" />
                <Item icon={<Check size={14} />} label={menu.s.done === 1 ? "Retirer « faite »" : "Séance faite"} onClick={() => p.onSetDone(menu.s, menu.date, menu.s.done === 1 ? 0 : 1)} />
                <Item icon={<X size={14} />} label={menu.s.done === 2 ? "Retirer « non faite »" : "Séance non faite"} onClick={() => p.onSetDone(menu.s, menu.date, menu.s.done === 2 ? 0 : 2)} />
                <div className="my-1 h-px bg-border" />
                <Item icon={<EyeOff size={14} />} label="Masquer pour ce jour" onClick={() => p.onHide(menu.s, menu.date)} />
                <Item icon={<Trash2 size={14} />} label="Supprimer de ce jour…" danger onClick={() => p.onDelete(menu.s, menu.date)} />
              </>
            ) : p.clip ? (
              <Item icon={<ClipboardPaste size={14} />} label={`Coller « ${p.clip.title} » ici`} onClick={() => p.onPaste(menu.date)} />
            ) : (
              <p className="px-3 py-2 text-xs text-muted-foreground">Clic droit sur une séance › Copier, puis clic droit ici › Coller.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Item({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm", danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted")}>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
