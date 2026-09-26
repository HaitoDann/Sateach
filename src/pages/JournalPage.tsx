import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, Plus, Printer } from "lucide-react";
import PageHeader from "../components/PageHeader";
import SessionCard, { FLUSH_EVENT } from "../components/journal/SessionCard";
import PrintSheet from "../components/journal/PrintSheet";
import SessionDialog, { type SessionValues } from "../components/SessionDialog";
import { Button } from "../components/ui/Button";
import { useVault } from "../context/VaultContext";
import {
  createOneOffSession, deleteJournalEntry, getDatesWithContent, getJournalDay, saveDayNotes, saveSessionFields,
} from "../lib/db";
import {
  DAY_SHORT, addDays, fmtDuration, fmtLongDate, fmtTime, fromDateKey, stepSchoolDay, toDateKey, weekdayIndex,
} from "../lib/time";
import type { DaySession, EntryFields, PageName } from "../lib/types";
import { cn } from "../lib/utils";

/** Remembered while the app is open, so switching views keeps the same day. */
let rememberedDate: string | null = null;

function initialDate(schoolDays: number[]): string {
  if (rememberedDate) return rememberedDate;
  const today = new Date();
  if (schoolDays.length === 0 || schoolDays.includes(weekdayIndex(today))) return toDateKey(today);
  return toDateKey(stepSchoolDay(today, 1, schoolDays));
}

export default function JournalPage({ onNavigate }: { onNavigate: (p: PageName) => void }) {
  const { domains, domainById, slots, week, toast, confirm } = useVault();
  const [date, setDate] = useState(() => initialDate(week.days));
  const [sessions, setSessions] = useState<DaySession[]>([]);
  const [notes, setNotes] = useState("");
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; session: DaySession } | null>(null);
  const [withContent, setWithContent] = useState<Set<string>>(new Set());
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const d = fromDateKey(date);
  const dateLabel = fmtLongDate(d);
  const isToday = date === toDateKey(new Date());
  const isSchoolDay = week.days.includes(weekdayIndex(d));

  // Week strip: the school days of the displayed week.
  const monday = addDays(d, -weekdayIndex(d));
  const weekDates = (week.days.length ? week.days : [0, 1, 2, 3, 4]).map((i) => addDays(monday, i));
  const weekKey = toDateKey(monday);

  const load = useCallback(async () => {
    const day = await getJournalDay(date, slots);
    setSessions(day.sessions);
    setNotes(day.notes);
    setLoadedDate(date);
  }, [date, slots]);

  useEffect(() => { rememberedDate = date; void load(); }, [date, load]);

  const refreshWeekDots = useCallback(async () => {
    const from = weekKey;
    const to = toDateKey(addDays(fromDateKey(weekKey), 6));
    setWithContent(await getDatesWithContent(from, to));
  }, [weekKey]);

  useEffect(() => { void refreshWeekDots(); }, [refreshWeekDots, date]);

  // Keyboard: ← / → change day (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || dialog) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function go(dir: 1 | -1) {
    flushNotes();
    setDate(toDateKey(stepSchoolDay(fromDateKey(date), dir, week.days)));
  }

  function jump(key: string) {
    if (!key) return;
    flushNotes();
    setDate(key);
  }

  function changeNotes(v: string) {
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    const forDate = date;
    notesTimer.current = setTimeout(() => {
      notesTimer.current = null;
      void saveDayNotes(forDate, v).then(refreshWeekDots);
    }, 600);
  }

  function flushNotes() {
    if (!notesTimer.current) return;
    clearTimeout(notesTimer.current);
    notesTimer.current = null;
    if (loadedDate) void saveDayNotes(loadedDate, notes);
  }

  async function patchSession(s: DaySession, patch: EntryFields, reload = true) {
    try {
      await saveSessionFields(date, s, patch);
      if (reload) await load();
      else setSessions((all) => all.map((x) => (x.key === s.key ? { ...x, ...patch } as DaySession : x)));
      void refreshWeekDots();
    } catch (e) {
      toast(`Enregistrement impossible : ${e}`, "error");
    }
  }

  async function saveDialog(v: SessionValues) {
    if (!dialog) return;
    if (dialog.kind === "new") {
      await createOneOffSession(date, { title: v.title, domain_id: v.domain_id, start_min: v.start_min, end_min: v.end_min });
    } else {
      await saveSessionFields(date, dialog.session, { title: v.title, domain_id: v.domain_id, start_min: v.start_min, end_min: v.end_min });
    }
    setDialog(null);
    await load();
    void refreshWeekDots();
  }

  async function removeOneOff(s: DaySession) {
    const ok = await confirm({
      title: "Supprimer la séance ?",
      message: `« ${s.title || "Séance"} » et ses notes seront supprimées de ce jour.`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    await deleteJournalEntry(s.entryId);
    setDialog(null);
    await load();
    void refreshWeekDots();
  }

  function print() {
    window.dispatchEvent(new Event(FLUSH_EVENT));
    flushNotes();
    setTimeout(() => window.print(), 150);
  }

  const visible = sessions.filter((s) => !s.hidden);
  const hidden = sessions.filter((s) => s.hidden);
  const lessons = visible.filter((s) => s.domain_id && domainById.has(s.domain_id));
  const allExpanded = lessons.length > 0 && lessons.every((s) => expanded.has(s.key));

  const dayVolumes = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of visible) {
      if (!s.domain_id || !domainById.has(s.domain_id)) continue;
      m.set(s.domain_id, (m.get(s.domain_id) ?? 0) + s.end_min - s.start_min);
    }
    return [...m.entries()].map(([id, min]) => ({ domain: domainById.get(id)!, min })).sort((a, b) => b.min - a.min);
  }, [visible, domainById]);
  const dayTotal = dayVolumes.reduce((a, v) => a + v.min, 0);
  const doneCount = lessons.filter((s) => s.done).length;

  function toggle(key: string) {
    setExpanded((cur) => {
      const n = new Set(cur);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Cahier journal">
        <div className="flex items-center rounded-md border border-border">
          <button onClick={() => go(-1)} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" title="Jour précédent (←)">
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => jump(toDateKey(new Date()))}
            className={cn("h-8 border-x border-border px-3 text-xs", isToday ? "font-medium text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            Aujourd'hui
          </button>
          <button onClick={() => go(1)} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" title="Jour suivant (→)">
            <ChevronRight size={16} />
          </button>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => jump(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Choisir une date"
        />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={print}>
          <Printer size={14} />
          Imprimer
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* Day */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-6">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">{dateLabel}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {lessons.length === 0
                    ? isSchoolDay ? "Aucune séance prévue" : "Pas de classe ce jour-là"
                    : `${lessons.length} séance${lessons.length > 1 ? "s" : ""} · ${fmtDuration(dayTotal)}${doneCount ? ` · ${doneCount} faite${doneCount > 1 ? "s" : ""}` : ""}`}
                </p>
              </div>
              {lessons.length > 0 && (
                <button
                  onClick={() => setExpanded(allExpanded ? new Set() : new Set(lessons.map((s) => s.key)))}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                  {allExpanded ? "Tout replier" : "Tout déplier"}
                </button>
              )}
            </div>

            {loadedDate === date && (
              <div className="space-y-2">
                {visible.map((s, i) => (
                  <SessionCard
                    key={`${date}:${s.key}`}
                    index={i}
                    session={s}
                    domain={s.domain_id ? domainById.get(s.domain_id) : undefined}
                    expanded={expanded.has(s.key)}
                    onToggle={() => toggle(s.key)}
                    onSaveText={(patch) => patchSession(s, patch, false)}
                    onToggleDone={() => patchSession(s, { done: s.done ? 0 : 1 })}
                    onHide={() => s.oneOff ? removeOneOff(s) : patchSession(s, { hidden: 1 })}
                    onEditTime={() => setDialog({ kind: "edit", session: s })}
                    onDelete={s.oneOff ? () => removeOneOff(s) : undefined}
                  />
                ))}

                {visible.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      {isSchoolDay
                        ? "L'emploi du temps ne prévoit aucune séance ce jour-là."
                        : "Ce jour n'est pas un jour de classe dans vos réglages."}
                    </p>
                    {slots.length === 0 && (
                      <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => onNavigate("timetable")}>
                        <CalendarRange size={14} />
                        Construire l'emploi du temps
                      </Button>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setDialog({ kind: "new" })}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:bg-accent/50 hover:text-accent-foreground"
                >
                  <Plus size={15} />
                  Ajouter une séance pour ce jour
                </button>

                {hidden.length > 0 && (
                  <div className="pt-4">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">Annulées ce jour-là</div>
                    {hidden.map((s) => {
                      const dom = s.domain_id ? domainById.get(s.domain_id) : undefined;
                      return (
                        <div key={s.key} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/60">
                          <span className="w-[92px] shrink-0 tabular-nums text-xs">{fmtTime(s.start_min)} – {fmtTime(s.end_min)}</span>
                          <span className="h-2 w-2 shrink-0 rounded-full opacity-60" style={{ backgroundColor: dom?.color ?? "var(--border)" }} />
                          <span className="flex-1 truncate line-through">{s.title || dom?.name || "Séance"}</span>
                          <button onClick={() => patchSession(s, { hidden: 0 })} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-background hover:text-foreground">
                            <Eye size={12} /> Rétablir
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        <aside className="w-80 shrink-0 space-y-6 overflow-y-auto border-l border-border px-5 py-6">
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Semaine</h3>
            <div className="flex gap-1">
              {weekDates.map((wd) => {
                const k = toDateKey(wd);
                const selected = k === date;
                const today = k === toDateKey(new Date());
                return (
                  <button
                    key={k}
                    onClick={() => jump(k)}
                    className={cn(
                      "flex flex-1 flex-col items-center rounded-lg py-1.5 transition-colors",
                      selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    )}
                  >
                    <span className={cn("text-[10px]", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>{DAY_SHORT[weekdayIndex(wd)]}</span>
                    <span className={cn("text-sm font-medium tabular-nums", !selected && today && "text-brand-700 dark:text-brand-300")}>{wd.getDate()}</span>
                    <span className={cn("mt-0.5 h-1 w-1 rounded-full", withContent.has(k) ? (selected ? "bg-primary-foreground" : "bg-brand-500") : "bg-transparent")} />
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Notes du jour</h3>
            <textarea
              value={notes}
              onChange={(e) => changeNotes(e.target.value)}
              onBlur={flushNotes}
              placeholder="Absents, rappels, mots aux parents, réunion…"
              rows={6}
              className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </section>

          {dayVolumes.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Répartition de la journée</h3>
              <div className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
                {dayVolumes.map(({ domain, min }) => (
                  <div key={domain.id} style={{ width: `${(min / dayTotal) * 100}%`, backgroundColor: domain.color }} title={`${domain.name} · ${fmtDuration(min)}`} />
                ))}
              </div>
              <div className="space-y-1">
                {dayVolumes.map(({ domain, min }) => (
                  <div key={domain.id} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: domain.color }} />
                    <span className="flex-1 truncate text-foreground">{domain.name}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtDuration(min)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {dialog && (
        <SessionDialog
          heading={dialog.kind === "new" ? "Séance ponctuelle" : dialog.session.slotId ? "Modifier pour ce jour uniquement" : "Modifier la séance"}
          initial={
            dialog.kind === "new"
              ? { title: "", domain_id: domains[0]?.id ?? null, start_min: 13 * 60 + 30, end_min: 14 * 60 + 15, days: [] }
              : { title: dialog.session.title, domain_id: dialog.session.domain_id, start_min: dialog.session.start_min, end_min: dialog.session.end_min, days: [] }
          }
          onSave={saveDialog}
          onDelete={dialog.kind === "edit" && dialog.session.oneOff ? () => removeOneOff(dialog.session) : undefined}
          onClose={() => setDialog(null)}
        />
      )}

      <PrintSheet dateLabel={dateLabel} notes={notes} sessions={sessions} domainById={domainById} />
    </div>
  );
}
