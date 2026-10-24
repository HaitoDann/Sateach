import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, ChevronDown, Folder, FolderPlus, Pencil, Plus, Printer, RefreshCw, Sun, Trash2, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { AutoTextarea } from "../components/ui/AutoTextarea";
import { useVault } from "../context/VaultContext";
import {
  createSubject, deleteSubject, getEvents, getProgramming, getProgrammingWeeks, getSequences, getYearSettings, renameSubject,
  saveEvent, saveProgramming, saveProgrammingWeek, saveYearSettings,
} from "../lib/db";
import { navFocus } from "../lib/nav";
import { fetchSchoolCalendar, schoolYearOf } from "../lib/schoolCalendar";
import { fromDateKey } from "../lib/time";
import type { Domain, PageName, Sequence, Subject, YearSettings } from "../lib/types";
import { computePeriods, defaultYear, periodWeeks, validHolidays, type Period, type SchoolWeek } from "../lib/year";
import { cn, withAlpha } from "../lib/utils";

const fmt = (k: string) => (k ? fromDateKey(k).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "…");
const DEFAULT_WEEKS = 7;

let rememberedPeriod = 1;
let rememberedDomain: string | null = null;

export default function YearPage({ onNavigate }: { onNavigate: (p: PageName) => void }) {
  const { domains, subjects, reload, toast, confirm } = useVault();
  const [year, setYear] = useState<YearSettings | null>(null);
  const [period, setPeriod] = useState(rememberedPeriod);
  const [domainId, setDomainId] = useState<string | null>(rememberedDomain);
  const [weeksContent, setWeeksContent] = useState<Map<string, string>>(new Map());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [fetching, setFetching] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    void (async () => {
      const [y, n, q] = await Promise.all([getYearSettings(), getProgramming(), getSequences()]);
      const yy = y ?? defaultYear();
      setYear(yy);
      setNotes(n);
      setSequences(q);
      // First visit: fill the holidays automatically (needs Internet).
      if (!y || validHolidays(yy).length === 0) { setShowCalendar(true); void autoFill(yy, true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadWeeks = useCallback(async () => setWeeksContent(await getProgrammingWeeks(period)), [period]);
  useEffect(() => { rememberedPeriod = period; void loadWeeks(); }, [period, loadWeeks]);

  // Save the calendar settings shortly after each change.
  const firstSave = useRef(true);
  useEffect(() => {
    if (!year) return;
    if (firstSave.current) { firstSave.current = false; return; }
    const t = setTimeout(() => { void saveYearSettings(year); }, 500);
    return () => clearTimeout(t);
  }, [year]);

  async function autoFill(y: YearSettings, silent = false) {
    setFetching(true);
    try {
      const official = await fetchSchoolCalendar(schoolYearOf(y.schoolStart || defaultYear().schoolStart), y.zone);
      const extra = y.holidays.filter((h) => h.start && h.end && !official.holidays.some((o) => o.start === h.start));
      setYear({
        ...y,
        schoolStart: official.schoolStart || y.schoolStart,
        schoolEnd: official.schoolEnd || y.schoolEnd,
        holidays: [...official.holidays, ...extra.filter((h) => /pont|congé/i.test(h.name))],
      });
      toast(`Calendrier officiel de la zone ${y.zone} chargé`);
    } catch (e) {
      if (!silent) toast(`Impossible de charger le calendrier officiel (${e}). Vérifiez la connexion Internet, ou saisissez les dates.`, "error");
    } finally {
      setFetching(false);
    }
  }

  if (!year) return null;
  const periods = computePeriods(year);
  const cur: Period = periods.find((p) => p.n === period) ?? { n: period, start: "", end: "", weeks: 0 };
  const weeks: SchoolWeek[] = periodWeeks(cur).length
    ? periodWeeks(cur)
    : Array.from({ length: DEFAULT_WEEKS }, (_, i) => ({ n: i + 1, start: "", end: "" }));
  const set = (patch: Partial<YearSettings>) => setYear({ ...year, ...patch });
  const setHoliday = (i: number, patch: Partial<YearSettings["holidays"][number]>) =>
    set({ holidays: year.holidays.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  // Domains to show: those with dossiers first (Français, Mathématiques…).
  const withDossiers = domains.filter((d) => subjects.some((s) => s.domain_id === d.id));
  const current = domains.find((d) => d.id === domainId) ?? withDossiers[0] ?? domains[0];

  function changeWeek(subjectId: string, week: number, v: string) {
    const k = `${subjectId}:${week}`;
    setWeeksContent((m) => new Map(m).set(k, v));
    const t = timers.current.get(k);
    if (t) clearTimeout(t);
    timers.current.set(k, setTimeout(() => { void saveProgrammingWeek(subjectId, period, week, v); }, 600));
  }

  function changeNotes(dId: string, v: string) {
    const k = `${dId}:${period}`;
    setNotes((m) => new Map(m).set(k, v));
    const t = timers.current.get(k);
    if (t) clearTimeout(t);
    timers.current.set(k, setTimeout(() => { void saveProgramming(dId, period, v); }, 600));
  }

  async function addDossier(d: Domain) {
    await createSubject(d.id, "Nouveau dossier");
    await reload();
  }

  async function removeDossier(s: Subject) {
    const ok = await confirm({
      title: `Supprimer le dossier « ${s.name} » ?`,
      message: "Sa programmation (toutes périodes) est effacée. Les fiches et séquences rangées dedans sont conservées, hors dossier.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    await deleteSubject(s.id);
    await reload();
    await loadWeeks();
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Programmation" subtitle={cur.start ? `Période ${period} · ${fmt(cur.start)} → ${fmt(cur.end)} · ${cur.weeks} semaines` : `Période ${period}`}>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()} title="Imprime la période choisie, un domaine par page">
          <Printer size={14} /> Imprimer / PDF
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 px-6 py-5">
          {/* School calendar (collapsible) */}
          <section className="rounded-xl border border-border bg-card">
            <button onClick={() => setShowCalendar((v) => !v)} className="flex w-full items-center gap-3 px-5 py-3 text-left">
              <Sun size={15} className="text-brand-600" />
              <span className="text-sm font-medium text-foreground">Calendrier scolaire</span>
              <span className="text-xs text-muted-foreground">
                Zone {year.zone} · {validHolidays(year).length} vacances · {periods.length} période{periods.length > 1 ? "s" : ""}
              </span>
              <ChevronDown size={15} className={cn("ml-auto text-muted-foreground transition-transform", showCalendar && "rotate-180")} />
            </button>
            {showCalendar && (
              <div className="border-t border-border px-5 py-4">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <SegmentedControl<"A" | "B" | "C">
                    options={[{ value: "A", label: "Zone A" }, { value: "B", label: "Zone B" }, { value: "C", label: "Zone C" }]}
                    value={year.zone}
                    onChange={(zone) => { const y = { ...year, zone }; setYear(y); void autoFill(y); }}
                  />
                  <Button size="sm" className="gap-1.5" onClick={() => void autoFill(year)} disabled={fetching}>
                    <RefreshCw size={14} className={fetching ? "animate-spin" : ""} /> Remplir automatiquement (calendrier officiel)
                  </Button>
                  <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={addHolidaysToCalendar}>
                    <CalendarPlus size={14} /> Ajouter les vacances au calendrier
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-x-8">
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_140px_140px_28px] gap-2 text-[11px] font-medium text-muted-foreground">
                      <span>Vacances</span><span>Premier jour</span><span>Dernier jour</span><span />
                    </div>
                    {year.holidays.map((h, i) => (
                      <div key={i} className="grid grid-cols-[1fr_140px_140px_28px] items-center gap-2">
                        <Input value={h.name} onChange={(e) => setHoliday(i, { name: e.target.value })} className="h-8 text-sm" />
                        <Input type="date" value={h.start} onChange={(e) => setHoliday(i, { start: e.target.value, end: h.end && h.end >= e.target.value ? h.end : e.target.value })} className="h-8 text-xs" />
                        <Input type="date" value={h.end} min={h.start} onChange={(e) => setHoliday(i, { end: e.target.value })} className="h-8 text-xs" />
                        <button onClick={() => set({ holidays: year.holidays.filter((_, j) => j !== i) })} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Retirer"><X size={14} /></button>
                      </div>
                    ))}
                    <button onClick={() => set({ holidays: [...year.holidays, { name: "Pont / congé", start: "", end: "" }] })}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Plus size={13} /> Ajouter un pont ou un congé
                    </button>
                  </div>
                  <div className="space-y-3">
                    <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">Rentrée des élèves
                      <Input type="date" value={year.schoolStart} onChange={(e) => set({ schoolStart: e.target.value })} className="h-8 w-40 text-xs" />
                    </label>
                    <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">Dernier jour de classe
                      <Input type="date" value={year.schoolEnd} onChange={(e) => set({ schoolEnd: e.target.value })} className="h-8 w-40 text-xs" />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Période + domaine */}
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => {
              const p = periods.find((x) => x.n === n);
              return (
                <button key={n} onClick={() => setPeriod(n)}
                  className={cn("rounded-xl border px-4 py-2 text-left transition-colors",
                    period === n ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
                  <div className="text-sm font-semibold">P{n}</div>
                  <div className={cn("text-[11px]", period === n ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {p ? `${fmt(p.start)} → ${fmt(p.end)} · ${p.weeks} sem.` : "dates à venir"}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <button key={d.id} onClick={() => { setDomainId(d.id); rememberedDomain = d.id; }}
                className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  current?.id === d.id ? "border-transparent font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted")}
                style={current?.id === d.id ? { backgroundColor: withAlpha(d.color, 0.16), boxShadow: `inset 0 0 0 1.5px ${d.color}` } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name}
                <span className="tabular-nums text-muted-foreground">{subjects.filter((s) => s.domain_id === d.id).length || ""}</span>
              </button>
            ))}
          </div>

          {current && (
            <DomainProgramming
              domain={current}
              period={period}
              weeks={weeks}
              dossiers={subjects.filter((s) => s.domain_id === current.id)}
              content={weeksContent}
              notes={notes.get(`${current.id}:${period}`) ?? ""}
              sequences={sequences.filter((s) => s.domain_id === current.id && s.period === period)}
              onChangeWeek={changeWeek}
              onChangeNotes={(v) => changeNotes(current.id, v)}
              onAddDossier={() => addDossier(current)}
              onRename={async (s, name) => { await renameSubject(s.id, name); await reload(); }}
              onRemove={removeDossier}
              onOpenSequence={(id) => { navFocus.sequenceId = id; onNavigate("sequences"); }}
            />
          )}
        </div>
      </div>

      <YearPrint period={period} weeks={weeks} content={weeksContent} />
    </div>
  );
}

function DomainProgramming({ domain, period, weeks, dossiers, content, notes, sequences, onChangeWeek, onChangeNotes, onAddDossier, onRename, onRemove, onOpenSequence }: {
  domain: Domain; period: number; weeks: SchoolWeek[]; dossiers: Subject[]; content: Map<string, string>; notes: string; sequences: Sequence[];
  onChangeWeek: (subjectId: string, week: number, v: string) => void; onChangeNotes: (v: string) => void; onAddDossier: () => void;
  onRename: (s: Subject, name: string) => Promise<void>; onRemove: (s: Subject) => void; onOpenSequence: (id: string) => void;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-center text-lg font-semibold text-foreground">
        Programmation {domain.name.toLowerCase()} P{period}
      </h2>
      {sequences.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
          Séquences de la période :
          {sequences.map((s) => (
            <button key={s.id} onClick={() => onOpenSequence(s.id)} className="rounded-full px-2 py-0.5 font-medium text-foreground/80 hover:underline" style={{ backgroundColor: withAlpha(domain.color, 0.16) }}>
              {s.title}
            </button>
          ))}
        </div>
      )}

      {dossiers.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
          Pas encore de dossier pour {domain.name}. Créez-en un (par exemple « Lecture », « Chant »…) pour programmer semaine par semaine.
        </div>
      )}

      {dossiers.map((s) => (
        <DossierTable key={s.id} subject={s} color={domain.color} weeks={weeks} content={content}
          onChange={(w, v) => onChangeWeek(s.id, w, v)} onRename={(name) => onRename(s, name)} onRemove={() => onRemove(s)} />
      ))}

      <button onClick={onAddDossier} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary/60 hover:bg-accent/50 hover:text-accent-foreground">
        <FolderPlus size={15} /> Ajouter un dossier à {domain.name}
      </button>

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Notes de la période</div>
        <AutoTextarea value={notes} onChange={onChangeNotes} minRows={2} placeholder="Remarques, projets, sorties prévues…"
          className="rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" />
      </div>
    </section>
  );
}

function DossierTable({ subject, color, weeks, content, onChange, onRename, onRemove }: {
  subject: Subject; color: string; weeks: SchoolWeek[]; content: Map<string, string>;
  onChange: (week: number, v: string) => void; onRename: (name: string) => Promise<void>; onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(subject.name);
  useEffect(() => setName(subject.name), [subject.name]);
  const commit = async () => { setEditing(false); if (name.trim() && name.trim() !== subject.name) await onRename(name.trim()); else setName(subject.name); };

  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative flex items-center justify-center gap-2 border-b border-border px-3 py-2" style={{ backgroundColor: withAlpha(color, 0.08) }}>
        <Folder size={14} style={{ color }} />
        {editing ? (
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void commit()}
            onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") { setName(subject.name); setEditing(false); } }}
            className="h-7 w-56 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        ) : (
          <span className="text-sm font-semibold text-foreground" onDoubleClick={() => setEditing(true)}>{subject.name}</span>
        )}
        <div className="absolute right-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={() => setEditing(true)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Renommer"><Pencil size={13} /></button>
          <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Supprimer le dossier"><Trash2 size={13} /></button>
        </div>
      </div>
      {weeks.map((w) => (
        <div key={w.n} className="grid grid-cols-[112px_1fr] border-b border-border last:border-b-0">
          <div className="border-r border-border px-3 py-1.5">
            <div className="text-sm font-semibold text-foreground">S{w.n}</div>
            {w.start && <div className="text-[10px] text-muted-foreground">{fmt(w.start)}{w.end !== w.start ? ` – ${fmt(w.end)}` : ""}</div>}
          </div>
          <AutoTextarea value={content.get(`${subject.id}:${w.n}`) ?? ""} onChange={(v) => onChange(w.n, v)} minRows={1}
            placeholder="—" label={`${subject.name} S${w.n}`}
            className="rounded-none border-0 bg-transparent px-3 py-1.5 text-[13px] shadow-none focus-visible:ring-1" />
        </div>
      ))}
    </div>
  );
}

/** Printed like Camille's document: one page per domain, a table per dossier. */
function YearPrint({ period, weeks, content }: { period: number; weeks: SchoolWeek[]; content: Map<string, string> }) {
  const { domains, subjects } = useVault();
  const b = "1px solid #444";
  const printed = domains.filter((d) => subjects.some((s) => s.domain_id === d.id));
  return createPortal(
    <div className="print-root" style={{ fontFamily: '"Onest Variable", system-ui, sans-serif', fontSize: 10, color: "#111" }}>
      {printed.map((d, i) => (
        <div key={d.id} style={{ breakBefore: i > 0 ? "page" : undefined }}>
          <div style={{ textAlign: "center", fontSize: 15, fontWeight: 600, margin: "4px 0 12px" }}>Programmation {d.name.toLowerCase()} P{period}</div>
          {subjects.filter((s) => s.domain_id === d.id).map((s) => (
            <div key={s.id} className="print-break-avoid" style={{ marginBottom: 12 }}>
              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{s.name}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.n}>
                      <td style={{ border: b, padding: "3px 6px", width: 36, fontWeight: 600, verticalAlign: "top" }}>S{w.n}</td>
                      <td style={{ border: b, padding: "3px 6px", whiteSpace: "pre-wrap" }}>{content.get(`${s.id}:${w.n}`) ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>,
    document.body
  );
}
