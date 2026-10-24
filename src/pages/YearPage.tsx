import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, Plus, Printer, Sun, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { AutoTextarea } from "../components/ui/AutoTextarea";
import { useVault } from "../context/VaultContext";
import { getEvents, getProgramming, getSequences, getYearSettings, saveEvent, saveProgramming, saveYearSettings } from "../lib/db";
import { navFocus } from "../lib/nav";
import { fromDateKey } from "../lib/time";
import type { PageName, Sequence, YearSettings } from "../lib/types";
import { computePeriods, defaultYear, validHolidays, type Period } from "../lib/year";
import { withAlpha } from "../lib/utils";

const fmt = (k: string) => (k ? fromDateKey(k).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "…");

export default function YearPage({ onNavigate }: { onNavigate: (p: PageName) => void }) {
  const { domains, toast } = useVault();
  const [year, setYear] = useState<YearSettings | null>(null);
  const [prog, setProg] = useState<Map<string, string>>(new Map());
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const load = useCallback(async () => {
    const [y, p, q] = await Promise.all([getYearSettings(), getProgramming(), getSequences()]);
    setYear(y ?? defaultYear());
    setProg(p);
    setSequences(q);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Save the calendar settings shortly after each change.
  const first = useRef(true);
  useEffect(() => {
    if (!year) return;
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { void saveYearSettings(year); }, 500);
    return () => clearTimeout(t);
  }, [year]);

  if (!year) return null;
  const periods = computePeriods(year);
  const set = (patch: Partial<YearSettings>) => setYear({ ...year, ...patch });
  const setHoliday = (i: number, patch: Partial<YearSettings["holidays"][number]>) =>
    set({ holidays: year.holidays.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  function changeCell(domainId: string, period: number, v: string) {
    const k = `${domainId}:${period}`;
    setProg((m) => new Map(m).set(k, v));
    const t = timers.current.get(k);
    if (t) clearTimeout(t);
    timers.current.set(k, setTimeout(() => { void saveProgramming(domainId, period, v); }, 600));
  }

  async function addHolidaysToCalendar() {
    const hol = validHolidays(year!);
    if (hol.length === 0) { toast("Renseignez d'abord les dates des vacances", "error"); return; }
    const existing = await getEvents(hol[0].start, hol[hol.length - 1].end);
    let added = 0;
    for (const h of hol) {
      if (existing.some((e) => e.kind === "holiday" && e.start_date === h.start)) continue;
      await saveEvent({ title: h.name, kind: "holiday", start_date: h.start, end_date: h.end, start_min: null, end_min: null, notes: `Zone ${year!.zone}`, reminder_min: 7 * 24 * 60 });
      added++;
    }
    toast(added ? `${added} période${added > 1 ? "s" : ""} de vacances ajoutée${added > 1 ? "s" : ""} au calendrier` : "Les vacances sont déjà dans le calendrier");
  }

  const nbCols = Math.max(5, periods.length);
  const cols = Array.from({ length: nbCols }, (_, i) => periods[i] ?? ({ n: i + 1, start: "", end: "", weeks: 0 } as Period));

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Programmation" subtitle="L'année en 5 périodes">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}><Printer size={14} /> Imprimer / PDF</Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
          {/* School calendar */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <h2 className="text-sm font-medium text-foreground">Calendrier scolaire</h2>
              <SegmentedControl<"A" | "B" | "C">
                options={[{ value: "A", label: "Zone A" }, { value: "B", label: "Zone B" }, { value: "C", label: "Zone C" }]}
                value={year.zone}
                onChange={(zone) => set({ zone })}
              />
              <span className="text-xs text-muted-foreground">Dates officielles : education.gouv.fr › Calendrier scolaire</span>
              <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={addHolidaysToCalendar}>
                <CalendarPlus size={14} /> Ajouter les vacances au calendrier
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-3">
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_150px_150px_28px] gap-2 text-[11px] font-medium text-muted-foreground">
                  <span>Vacances</span><span>Premier jour de vacances</span><span>Dernier jour de vacances</span><span />
                </div>
                {year.holidays.map((h, i) => (
                  <div key={i} className="grid grid-cols-[1fr_150px_150px_28px] items-center gap-2">
                    <Input value={h.name} onChange={(e) => setHoliday(i, { name: e.target.value })} className="h-8 text-sm" />
                    <Input type="date" value={h.start} onChange={(e) => setHoliday(i, { start: e.target.value, end: h.end && h.end >= e.target.value ? h.end : e.target.value })} className="h-8 text-xs" />
                    <Input type="date" value={h.end} min={h.start} onChange={(e) => setHoliday(i, { end: e.target.value })} className="h-8 text-xs" />
                    <button onClick={() => set({ holidays: year.holidays.filter((_, j) => j !== i) })} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Retirer"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => set({ holidays: [...year.holidays, { name: "Pont / congé", start: "", end: "" }] })}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Plus size={13} /> Ajouter des vacances ou un pont
                </button>
              </div>
              <div className="space-y-3">
                <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">Rentrée des élèves
                  <Input type="date" value={year.schoolStart} onChange={(e) => set({ schoolStart: e.target.value })} className="h-8 w-44 text-xs" />
                </label>
                <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">Dernier jour de classe
                  <Input type="date" value={year.schoolEnd} onChange={(e) => set({ schoolEnd: e.target.value })} className="h-8 w-44 text-xs" />
                </label>
              </div>
            </div>
          </section>

          {/* Périodes */}
          <section className="grid gap-3" style={{ gridTemplateColumns: `repeat(${nbCols}, minmax(0, 1fr))` }}>
            {cols.map((p) => (
              <div key={p.n} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-foreground">Période {p.n}</span>
                  <span className="text-xs tabular-nums text-brand-700 dark:text-brand-300">{p.weeks ? `${p.weeks} semaines` : "—"}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{p.start ? `${fmt(p.start)} → ${fmt(p.end)}` : "dates à renseigner"}</div>
              </div>
            ))}
          </section>
          {periods.length > 0 && periods.length !== 5 && (
            <p className="-mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Sun size={12} /> {periods.length} périodes calculées — renseignez les 4 vacances (Toussaint, Noël, hiver, printemps) pour obtenir les 5 périodes.</p>
          )}

          {/* Programmation grid */}
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid border-b border-border bg-muted/50 text-xs font-semibold text-foreground" style={{ gridTemplateColumns: `180px repeat(${nbCols}, minmax(0, 1fr))` }}>
              <div className="border-r border-border px-3 py-2">Domaine</div>
              {cols.map((p) => <div key={p.n} className="border-r border-border px-3 py-2 last:border-r-0">P{p.n}{p.weeks ? ` · ${p.weeks} sem.` : ""}</div>)}
            </div>
            {domains.map((d) => (
              <div key={d.id} className="grid border-b border-border last:border-b-0" style={{ gridTemplateColumns: `180px repeat(${nbCols}, minmax(0, 1fr))` }}>
                <div className="flex items-start gap-2 border-r border-border px-3 py-2 text-sm font-medium text-foreground" style={{ backgroundColor: withAlpha(d.color, 0.07) }}>
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />{d.name}
                </div>
                {cols.map((p) => {
                  const seqs = sequences.filter((s) => s.domain_id === d.id && s.period === p.n);
                  return (
                    <div key={p.n} className="border-r border-border last:border-r-0">
                      {seqs.length > 0 && (
                        <div className="flex flex-wrap gap-1 px-2 pt-1.5">
                          {seqs.map((s) => (
                            <button key={s.id} onClick={() => { navFocus.sequenceId = s.id; onNavigate("sequences"); }}
                              className="rounded-full px-2 py-px text-[11px] font-medium text-foreground/80 hover:underline" style={{ backgroundColor: withAlpha(d.color, 0.16) }}>
                              {s.title}
                            </button>
                          ))}
                        </div>
                      )}
                      <AutoTextarea value={prog.get(`${d.id}:${p.n}`) ?? ""} onChange={(v) => changeCell(d.id, p.n, v)} minRows={2}
                        placeholder="Notions abordées…" label={`${d.name} période ${p.n}`}
                        className="rounded-none border-0 bg-transparent px-2.5 py-1.5 text-[12px] shadow-none focus-visible:ring-1" />
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
          <p className="text-xs text-muted-foreground">Les séquences apparaissent ici quand une période leur est attribuée (page Séquences). Les jours de vacances sont signalés dans le cahier journal.</p>
        </div>
      </div>

      <YearPrint year={year} cols={cols} prog={prog} sequences={sequences} />
    </div>
  );
}

function YearPrint({ year, cols, prog, sequences }: { year: YearSettings; cols: Period[]; prog: Map<string, string>; sequences: Sequence[] }) {
  const { domains } = useVault();
  const b = "1px solid #444";
  return createPortal(
    <div className="print-root print-landscape" style={{ fontFamily: '"Onest Variable", system-ui, sans-serif', fontSize: 9, color: "#111" }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #00CEC8", paddingBottom: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Programmation annuelle</span>
        <span style={{ color: "#555" }}>Zone {year.zone} · Sat'each</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ border: b, background: "#e8e8e8", width: "13%", padding: 4 }}>Domaine</th>
            {cols.map((p) => (
              <th key={p.n} style={{ border: b, background: "#e8e8e8", padding: 4 }}>
                Période {p.n}<div style={{ fontWeight: 400, fontSize: 8 }}>{p.start ? `${fmt(p.start)} → ${fmt(p.end)} · ${p.weeks} sem.` : ""}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.id} className="print-break-avoid">
              <td style={{ border: b, padding: 4, fontWeight: 600, borderLeft: `4px solid ${d.color}` }}>{d.name}</td>
              {cols.map((p) => (
                <td key={p.n} style={{ border: b, padding: 4, verticalAlign: "top", whiteSpace: "pre-wrap" }}>
                  {sequences.filter((s) => s.domain_id === d.id && s.period === p.n).map((s) => <div key={s.id} style={{ fontWeight: 600 }}>• {s.title}</div>)}
                  {prog.get(`${d.id}:${p.n}`) ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body
  );
}
