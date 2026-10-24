import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ClipboardPaste, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Eye, Plus, Printer, Sun } from "lucide-react";
import UndoButton from "../components/common/UndoButton";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Dialog } from "../components/ui/Dialog";
import PageHeader from "../components/PageHeader";
import SessionCard, { FLUSH_EVENT } from "../components/journal/SessionCard";
import PrintSheet from "../components/journal/PrintSheet";
import SessionDialog, { type SessionValues } from "../components/SessionDialog";
import { Button } from "../components/ui/Button";
import { UNDO_EVENT, useVault } from "../context/VaultContext";
import {
  copySessionTo, createOneOffSession, rateSession, deleteJournalEntry, getEntryRow, getEvents, getDatesWithContent, getJournalDay, getYearSettings,
  restoreEntryRow, saveDayNotes, savePrep, saveSessionFields,
} from "../lib/db";
import {
  DAY_SHORT, addDays, fmtDuration, fmtLongDate, fmtTime, fromDateKey, stepSchoolDay, toDateKey, weekdayIndex,
} from "../lib/time";
import type { CalendarEvent, DaySession, EntryFields, PageName, YearSettings } from "../lib/types";
import { navFocus, sessionClipboard, sessionDrag } from "../lib/nav";
import { ratingOf } from "../components/common/Rating";
import JournalWeek from "../components/journal/JournalWeek";
import { blankPrep } from "./PrepsPage";
import { holidayOn } from "../lib/year";
import { cn } from "../lib/utils";
import { useNow } from "../lib/useNow";
import { EVENT_KINDS, fmtEventTime } from "../lib/events";

/** Remembered while the app is open, so switching views keeps the same day. */
let rememberedDate: string | null = null;
let rememberedView: "day" | "week" = "day";

function initialDate(schoolDays: number[]): string {
  if (rememberedDate) return rememberedDate;
  const today = new Date();
  if (schoolDays.length === 0 || schoolDays.includes(weekdayIndex(today))) return toDateKey(today);
  return toDateKey(stepSchoolDay(today, 1, schoolDays));
}

export default function JournalPage({ onNavigate }: { onNavigate: (p: PageName) => void }) {
  const { domains, domainById, slots, week, toast, confirm, pushUndo } = useVault();
  const [date, setDate] = useState(() => initialDate(week.days));
  const [sessions, setSessions] = useState<DaySession[]>([]);
  const [notes, setNotes] = useState("");
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; session: DaySession } | null>(null);
  const [withContent, setWithContent] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [copying, setCopying] = useState<DaySession | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [year, setYear] = useState<YearSettings | null>(null);
  const [view, setView] = useState<"day" | "week">(() => rememberedView);
  const [clip, setClip] = useState(sessionClipboard.current);
  /** Bumped after each change so the week view reloads. */
  const [version, setVersion] = useState(0);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const d = fromDateKey(date);
  const dateLabel = fmtLongDate(d);
  const now = useNow();
  const isToday = date === toDateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isSchoolDay = week.days.includes(weekdayIndex(d));

  // Week strip: the school days of the displayed week.
  const monday = addDays(d, -weekdayIndex(d));
  const weekDates = (week.days.length ? week.days : [0, 1, 2, 3, 4]).map((i) => addDays(monday, i));
  const weekKey = toDateKey(monday);

  const load = useCallback(async () => {
    const [day, evs] = await Promise.all([getJournalDay(date, slots), getEvents(date, date)]);
    setEvents(evs);
    setSessions(day.sessions);
    setNotes(day.notes);
    setLoadedDate(date);
  }, [date, slots]);

  useEffect(() => { rememberedDate = date; void load(); }, [date, load]);
  useEffect(() => { void getYearSettings().then(setYear); }, []);
  useEffect(() => {
    const onUndo = () => { void load(); };
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => window.removeEventListener(UNDO_EVENT, onUndo);
  }, [load]);

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
    if (view === "week") setDate(toDateKey(addDays(fromDateKey(date), 7 * dir)));
    else setDate(toDateKey(stepSchoolDay(fromDateKey(date), dir, week.days)));
  }

  function switchView(v: "day" | "week") {
    rememberedView = v;
    setView(v);
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

  /** Run a change on some journal rows, with an undo that puts them back. */
  async function withUndo(label: string, ids: string[], op: () => Promise<void>) {
    try {
      const before = await Promise.all(ids.map(async (id) => [id, await getEntryRow(id)] as const));
      await op();
      pushUndo(label, async () => { for (const [id, row] of before) await restoreEntryRow(id, row); });
      await load();
      setVersion((v) => v + 1);
      void refreshWeekDots();
    } catch (e) {
      toast(`Enregistrement impossible : ${e}`, "error");
    }
  }

  async function saveText(s: DaySession, patch: EntryFields) {
    try {
      await saveSessionFields(date, s, patch);
      setSessions((all) => all.map((x) => (x.key === s.key ? { ...x, ...patch } as DaySession : x)));
      void refreshWeekDots();
    } catch (e) {
      toast(`Enregistrement impossible : ${e}`, "error");
    }
  }

  const titleOf = (s: DaySession) => s.title || domainById.get(s.domain_id ?? "")?.name || "Séance";

  function patchSession(s: DaySession, patch: EntryFields, label: string, d = date) {
    return withUndo(label, [s.entryId], () => saveSessionFields(d, s, patch));
  }

  function rate(s: DaySession, v: number, d = date) {
    const r = ratingOf(v);
    return withUndo(r ? `« ${titleOf(s)} » : ${r.label.toLowerCase()}` : "Bilan coloré retiré", [s.entryId], () => rateSession(d, s, v));
  }

  function clipboardCopy(s: DaySession, d = date) {
    window.dispatchEvent(new Event(FLUSH_EVENT));
    sessionClipboard.current = { date: d, key: s.key, title: titleOf(s) };
    setClip(sessionClipboard.current);
    toast(`« ${titleOf(s)} » copiée — clic droit › Coller sur un autre jour`);
  }

  async function paste(target: string) {
    const c = sessionClipboard.current;
    if (!c) return;
    const src = (await getJournalDay(c.date, slots)).sessions.find((x) => x.key === c.key);
    if (!src) { toast("La séance copiée n'existe plus", "error"); return; }
    await copyTo(src, [target], c.date);
  }

  async function saveDialog(v: SessionValues) {
    if (!dialog) return;
    if (dialog.kind === "new") {
      const id = await createOneOffSession(date, { title: v.title, domain_id: v.domain_id, start_min: v.start_min, end_min: v.end_min });
      pushUndo(`Séance ajoutée : ${v.title || "séance"}`, () => deleteJournalEntry(id));
      await load();
      void refreshWeekDots();
    } else {
      await patchSession(dialog.session, { title: v.title, domain_id: v.domain_id, start_min: v.start_min, end_min: v.end_min }, "Séance modifiée pour ce jour");
    }
    setDialog(null);
  }

  async function remove(s: DaySession, d = date) {
    const ok = await confirm({
      title: "Supprimer la séance de ce jour ?",
      message: s.oneOff
        ? `« ${titleOf(s)} » et ce que vous avez écrit dedans seront supprimés de ce jour. (L'emploi du temps n'est pas modifié.)`
        : `« ${titleOf(s)} » n'apparaîtra plus ce jour-là. L'emploi du temps et les autres jours ne changent pas. Pour simplement la cacher temporairement, utilisez plutôt « Masquer ».`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    setDialog(null);
    await withUndo(`Séance supprimée : ${titleOf(s)}`, [s.entryId], () =>
      s.oneOff ? deleteJournalEntry(s.entryId) : saveSessionFields(d, s, { hidden: 2 })
    );
  }

  async function copyTo(s: DaySession, dates: string[], from = date) {
    window.dispatchEvent(new Event(FLUSH_EVENT));
    await new Promise((r) => setTimeout(r, 120));
    const fresh = (await getJournalDay(from, slots)).sessions.find((x) => x.key === s.key) ?? s;
    const ids: string[] = [];
    for (const d of dates) ids.push(await copySessionTo(d, fresh));
    if (dates.includes(date)) await load();
    setVersion((v) => v + 1);
    pushUndo(`« ${titleOf(s)} » copiée sur ${dates.length} jour${dates.length > 1 ? "s" : ""}`, async () => {
      for (const id of ids) await deleteJournalEntry(id);
    });
    void refreshWeekDots();
  }

  async function openPrep(s: DaySession) {
    if (!s.prepId) {
      window.dispatchEvent(new Event(FLUSH_EVENT));
      await new Promise((r) => setTimeout(r, 120));
      const fresh = (await getJournalDay(date, slots)).sessions.find((x) => x.key === s.key) ?? s;
      const prepId = await savePrep({
        sequence_id: null, domain_id: fresh.domain_id, title: titleOf(fresh), number: null,
        duration_min: fresh.end_min - fresh.start_min, objective: fresh.objectives, skills: "", materials: fresh.materials,
        organisation: "", review: fresh.review,
        phases: fresh.progression.trim()
          ? [{ phase: "", duration: "", materials: "", progression: fresh.progression, students: "" }]
          : blankPrep().phases,
      });
      await saveSessionFields(date, fresh, { prep_id: prepId });
      navFocus.prepId = prepId;
    } else {
      navFocus.prepId = s.prepId;
    }
    onNavigate("preps");
  }

  function onWeekDrop(e: React.DragEvent, k: string) {
    setDropDay(null);
    const s = sessions.find((x) => x.key === sessionDrag.key);
    sessionDrag.key = null;
    if (!s || k === date) return;
    e.preventDefault();
    void copyTo(s, [k]);
  }

  function print() {
    window.dispatchEvent(new Event(FLUSH_EVENT));
    flushNotes();
    setTimeout(() => window.print(), 150);
  }

  const visible = sessions.filter((s) => s.hidden !== 2);
  const removed = sessions.filter((s) => s.hidden === 2);
  const active = visible.filter((s) => s.hidden === 0);
  const lessons = active.filter((s) => s.domain_id && domainById.has(s.domain_id));
  const holiday = holidayOn(year, date);
  const allExpanded = active.length > 0 && active.every((s) => expanded.has(s.key));

  const dayVolumes = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of active) {
      if (!s.domain_id || !domainById.has(s.domain_id)) continue;
      m.set(s.domain_id, (m.get(s.domain_id) ?? 0) + s.end_min - s.start_min);
    }
    return [...m.entries()].map(([id, min]) => ({ domain: domainById.get(id)!, min })).sort((a, b) => b.min - a.min);
  }, [active, domainById]);
  const dayTotal = dayVolumes.reduce((a, v) => a + v.min, 0);
  const doneCount = lessons.filter((s) => s.done === 1).length;
  const notDoneCount = lessons.filter((s) => s.done === 2).length;

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
        <UndoButton />
        <SegmentedControl<"day" | "week">
          options={[{ value: "day", label: "Jour" }, { value: "week", label: "Semaine" }]}
          value={view}
          onChange={switchView}
        />
        <div className="flex items-center rounded-md border border-border">
          <button onClick={() => go(-1)} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" title={view === "week" ? "Semaine précédente" : "Jour précédent (←)"}>
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => jump(toDateKey(new Date()))}
            className={cn("h-8 border-x border-border px-3 text-xs", isToday ? "font-medium text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            Aujourd'hui
          </button>
          <button onClick={() => go(1)} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" title={view === "week" ? "Semaine suivante" : "Jour suivant (→)"}>
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

      {view === "week" ? (
        <JournalWeek
          dates={weekDates.map(toDateKey)}
          today={toDateKey(now)}
          version={version}
          clip={clip}
          year={year}
          titleOf={titleOf}
          onOpenDay={(d) => { setDate(d); switchView("day"); }}
          onCopy={(s, d) => clipboardCopy(s, d)}
          onPaste={(d) => void paste(d)}
          onFill={(s, from, dates) => void copyTo(s, dates, from)}
          onSetDone={(s, d, v) => void patchSession(s, { done: v }, v === 1 ? `« ${titleOf(s)} » faite` : v === 2 ? `« ${titleOf(s)} » non faite` : "Validation retirée", d)}
          onHide={(s, d) => void patchSession(s, { hidden: 1 }, `« ${titleOf(s)} » masquée pour ce jour`, d)}
          onDelete={(s, d) => void remove(s, d)}
        />
      ) : (
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
                    : `${lessons.length} séance${lessons.length > 1 ? "s" : ""} · ${fmtDuration(dayTotal)}${doneCount ? ` · ${doneCount} faite${doneCount > 1 ? "s" : ""}` : ""}${notDoneCount ? ` · ${notDoneCount} non faite${notDoneCount > 1 ? "s" : ""}` : ""}`}
                </p>
              </div>
              {active.length > 0 && (
                <button
                  onClick={() => setExpanded(allExpanded ? new Set() : new Set(active.map((s) => s.key)))}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                  {allExpanded ? "Tout replier" : "Tout déplier"}
                </button>
              )}
            </div>

            {holiday && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-brand-300/60 bg-accent px-4 py-2.5 text-sm text-accent-foreground">
                <Sun size={15} /> {holiday.name} — pas de classe (voir la programmation).
              </div>
            )}

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
                    onSaveText={(patch) => saveText(s, patch)}
                    onSetDone={(v) => patchSession(s, { done: v }, v === 1 ? `« ${titleOf(s)} » faite` : v === 2 ? `« ${titleOf(s)} » non faite` : "Validation retirée")}
                    live={isToday && s.hidden === 0 && s.start_min <= nowMin && nowMin < s.end_min}
                    onEdit={() => setDialog({ kind: "edit", session: s })}
                    onCopy={() => setCopying(s)}
                    onPrep={() => void openPrep(s)}
                    onHide={() => patchSession(s, { hidden: 1 }, `« ${titleOf(s)} » masquée pour ce jour`)}
                    onUnhide={() => patchSession(s, { hidden: 0 }, `« ${titleOf(s)} » réaffichée`)}
                    onDelete={() => void remove(s)}
                    onRate={(v) => void rate(s, v)}
                    onClipboardCopy={() => clipboardCopy(s)}
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

                {clip && (
                  <button
                    onClick={() => void paste(date)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/60 bg-accent/40 py-2.5 text-sm text-accent-foreground transition-colors hover:bg-accent"
                  >
                    <ClipboardPaste size={15} />
                    Coller « {clip.title} » ici
                  </button>
                )}
                <button
                  onClick={() => setDialog({ kind: "new" })}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:bg-accent/50 hover:text-accent-foreground"
                >
                  <Plus size={15} />
                  Ajouter une séance pour ce jour
                </button>

                {removed.length > 0 && (
                  <div className="pt-4">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">Supprimées de ce jour</div>
                    {removed.map((s) => {
                      const dom = s.domain_id ? domainById.get(s.domain_id) : undefined;
                      return (
                        <div key={s.key} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/60">
                          <span className="w-[92px] shrink-0 tabular-nums text-xs">{fmtTime(s.start_min)} – {fmtTime(s.end_min)}</span>
                          <span className="h-2 w-2 shrink-0 rounded-full opacity-60" style={{ backgroundColor: dom?.color ?? "var(--border)" }} />
                          <span className="flex-1 truncate line-through">{titleOf(s)}</span>
                          <button onClick={() => patchSession(s, { hidden: 0 }, `« ${titleOf(s)} » rétablie`)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-background hover:text-foreground">
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
            <p className="mb-2 text-[11px] text-muted-foreground/80">Glissez une séance (poignée ⋮⋮) sur un jour pour la copier.</p>
            <div className="flex gap-1">
              {weekDates.map((wd) => {
                const k = toDateKey(wd);
                const selected = k === date;
                const today = k === toDateKey(now);
                return (
                  <button
                    key={k}
                    onClick={() => jump(k)}
                    onDragOver={(e) => { if (sessionDrag.key && k !== date) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropDay(k); } }}
                    onDragLeave={() => setDropDay(null)}
                    onDrop={(e) => onWeekDrop(e, k)}
                    className={cn(
                      "flex flex-1 flex-col items-center rounded-lg py-1.5 transition-colors",
                      selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                      dropDay === k && "bg-accent ring-2 ring-primary"
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

          {events.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Agenda</h3>
              <div className="space-y-1.5">
                {events.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onNavigate("calendar")}
                    className="flex w-full items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: EVENT_KINDS[e.kind].color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{e.title}</span>
                      <span className="block text-xs text-muted-foreground">{EVENT_KINDS[e.kind].label} · {fmtEventTime(e)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

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

      )}

      {dialog && (
        <SessionDialog
          heading={dialog.kind === "new" ? "Séance pour ce jour uniquement" : "Modifier pour ce jour uniquement (l'emploi du temps ne change pas)"}
          initial={
            dialog.kind === "new"
              ? { title: "", domain_id: domains[0]?.id ?? null, start_min: 13 * 60 + 30, end_min: 14 * 60 + 15, days: [] }
              : { title: dialog.session.title, domain_id: dialog.session.domain_id, start_min: dialog.session.start_min, end_min: dialog.session.end_min, days: [] }
          }
          onSave={saveDialog}
          onDelete={dialog.kind === "edit" ? () => remove(dialog.session) : undefined}
          deleteLabel="Supprimer de ce jour"
          onClose={() => setDialog(null)}
        />
      )}

      {copying && (
        <CopyDialog
          session={copying}
          from={date}
          schoolDays={week.days}
          title={titleOf(copying)}
          onCopy={(dates) => { void copyTo(copying, dates); setCopying(null); }}
          onClose={() => setCopying(null)}
        />
      )}

      <PrintSheet dateLabel={dateLabel} notes={notes} sessions={sessions} domainById={domainById} />
    </div>
  );
}

/** Pick the days to copy a séance to (same hour, same details). */
function CopyDialog({ session, from, schoolDays, title, onCopy, onClose }: {
  session: DaySession; from: string; schoolDays: number[]; title: string; onCopy: (dates: string[]) => void; onClose: () => void;
}) {
  // The next 3 weeks of school days.
  const days: Date[] = [];
  let cur = fromDateKey(from);
  for (let i = 0; i < 15; i++) { cur = stepSchoolDay(cur, 1, schoolDays); days.push(cur); }
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const thisWeek = days.filter((d) => toDateKey(addDays(d, -weekdayIndex(d))) === toDateKey(addDays(fromDateKey(from), -weekdayIndex(fromDateKey(from))))).map(toDateKey);
  const perWeek = Math.max(1, schoolDays.length || 5);

  return (
    <Dialog
      title={`Copier « ${title} »`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="gap-1.5" disabled={picked.size === 0} onClick={() => onCopy([...picked].sort())}>
            <Copy size={13} /> Copier sur {picked.size} jour{picked.size > 1 ? "s" : ""}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Même horaire ({fmtTime(session.start_min)} – {fmtTime(session.end_min)}) et même contenu. L'emploi du temps n'est pas modifié.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {thisWeek.length > 0 && <QuickBtn label="Le reste de la semaine" onClick={() => setPicked(new Set(thisWeek))} />}
        <QuickBtn label={`Les ${perWeek} prochains jours`} onClick={() => setPicked(new Set(days.slice(0, perWeek).map(toDateKey)))} />
        <QuickBtn label="Les 2 prochaines semaines" onClick={() => setPicked(new Set(days.slice(0, perWeek * 2).map(toDateKey)))} />
        {picked.size > 0 && <QuickBtn label="Tout décocher" onClick={() => setPicked(new Set())} />}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {days.map((d) => {
          const k = toDateKey(d);
          const on = picked.has(k);
          return (
            <button key={k} onClick={() => toggle(k)}
              className={cn("flex flex-col items-center rounded-lg border py-1.5 text-xs transition-colors",
                on ? "border-transparent bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted")}>
              <span>{DAY_SHORT[weekdayIndex(d)]}</span>
              <span className="text-sm font-medium tabular-nums">{d.getDate()}/{d.getMonth() + 1}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
      {label}
    </button>
  );
}
