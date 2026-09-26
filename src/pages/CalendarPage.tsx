import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Textarea } from "../components/ui/Textarea";
import { useVault } from "../context/VaultContext";
import { deleteEvent, getEvents, saveEvent } from "../lib/db";
import { EVENT_KINDS, REMINDER_OPTIONS, fmtEventTime } from "../lib/events";
import { ensurePermission } from "../lib/notify";
import { getNotificationsEnabled, saveNotificationsEnabled } from "../lib/store";
import { DAY_SHORT, addDays, fmtTime, fromDateKey, parseTime, toDateKey, weekdayIndex } from "../lib/time";
import type { CalendarEvent, EventKind } from "../lib/types";
import { cn, withAlpha } from "../lib/utils";
import { useNow } from "../lib/useNow";

type Draft = Omit<CalendarEvent, "id"> & { id?: string };

function blankEvent(date: string): Draft {
  return { title: "", kind: "meeting", start_date: date, end_date: date, start_min: 17 * 60, end_min: 18 * 60, notes: "", reminder_min: 60 };
}

export default function CalendarPage() {
  const { toast, confirm } = useVault();
  const now = useNow();
  const todayKey = toDateKey(now);
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notifOn, setNotifOn] = useState(true);

  useEffect(() => { void getNotificationsEnabled().then(setNotifOn); }, []);

  // 6-week grid starting on the Monday on/before the 1st.
  const gridStart = addDays(month, -weekdayIndex(month));
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = toDateKey(days[0]);
  const to = toDateKey(days[41]);

  const load = useCallback(async () => {
    setEvents(await getEvents(from, to));
    setUpcoming((await getEvents(todayKey, toDateKey(addDays(fromDateKey(todayKey), 60)))).slice(0, 12));
  }, [from, to, todayKey]);
  useEffect(() => { void load(); }, [load]);

  async function toggleNotifications() {
    const next = !notifOn;
    if (next && !(await ensurePermission())) {
      toast("Les notifications sont bloquées par le système", "error");
      return;
    }
    setNotifOn(next);
    await saveNotificationsEnabled(next);
    toast(next ? "Rappels activés" : "Rappels désactivés");
  }

  async function save(d: Draft) {
    await saveEvent(d);
    if (d.reminder_min !== null && notifOn) void ensurePermission();
    setDraft(null);
    await load();
  }

  async function remove(d: Draft) {
    if (!d.id) return;
    const ok = await confirm({ title: "Supprimer l'évènement ?", message: `« ${d.title} » sera supprimé du calendrier.`, confirmLabel: "Supprimer", destructive: true });
    if (!ok) return;
    await deleteEvent(d.id);
    setDraft(null);
    await load();
  }

  const monthLabel = month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Calendrier" subtitle={<span className="capitalize">{monthLabel}</span>}>
        <button
          onClick={toggleNotifications}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
            notifOn ? "border-primary/50 bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted"
          )}
          title="Activer / désactiver les rappels"
        >
          {notifOn ? <Bell size={14} /> : <BellOff size={14} />}
          {notifOn ? "Rappels activés" : "Rappels désactivés"}
        </button>
        <div className="flex items-center rounded-md border border-border">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" title="Mois précédent">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))} className="h-8 border-x border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            Aujourd'hui
          </button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" title="Mois suivant">
            <ChevronRight size={16} />
          </button>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDraft(blankEvent(todayKey))}>
          <Plus size={15} /> Nouvel évènement
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* Month grid */}
        <div className="flex min-w-0 flex-1 flex-col px-6 pb-6 pt-4">
          <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
            {(Object.keys(EVENT_KINDS) as EventKind[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_KINDS[k].color }} />
                {EVENT_KINDS[k].label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 overflow-hidden rounded-t-xl border border-b-0 border-border bg-card">
            {DAY_SHORT.map((d) => <div key={d} className="py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-hidden rounded-b-xl border border-border bg-card">
            {days.map((day) => {
              const key = toDateKey(day);
              const inMonth = day.getMonth() === month.getMonth();
              const dayEvents = events.filter((e) => e.start_date <= key && e.end_date >= key);
              const holiday = dayEvents.some((e) => e.kind === "holiday");
              return (
                <div
                  key={key}
                  onClick={(e) => { if (e.target === e.currentTarget) setDraft(blankEvent(key)); }}
                  className={cn(
                    "group relative flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-l border-t border-border/70 p-1 transition-colors hover:bg-muted/50 [&:nth-child(7n+1)]:border-l-0 [&:nth-child(-n+7)]:border-t-0",
                    !inMonth && "bg-muted/30"
                  )}
                  style={holiday ? { backgroundColor: withAlpha(EVENT_KINDS.holiday.color, 0.07) } : undefined}
                >
                  <div className="pointer-events-none flex items-center justify-between px-0.5">
                    <span className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums",
                      key === todayKey ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/60"
                    )}>
                      {day.getDate()}
                    </span>
                    <Plus size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </div>
                  {dayEvents.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setDraft(e)}
                      title={`${e.title} · ${fmtEventTime(e)}`}
                      className="flex w-full items-center gap-1 truncate rounded px-1 py-px text-left text-[11px] text-foreground hover:brightness-95"
                      style={{ backgroundColor: withAlpha(EVENT_KINDS[e.kind].color, 0.16), borderLeft: `2px solid ${EVENT_KINDS[e.kind].color}` }}
                    >
                      {e.start_min !== null && e.start_date === key && <span className="shrink-0 tabular-nums text-muted-foreground">{fmtTime(e.start_min)}</span>}
                      <span className="truncate">{e.title}</span>
                      {e.reminder_min !== null && <Bell size={9} className="ml-auto shrink-0 opacity-50" />}
                    </button>
                  ))}
                  {dayEvents.length > 3 && <span className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 3} autres</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Upcoming */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-border px-5 py-5">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">À venir</h3>
          {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Rien de prévu dans les 60 prochains jours.</p>}
          <div className="space-y-2">
            {upcoming.map((e) => {
              const d = fromDateKey(e.start_date < todayKey ? todayKey : e.start_date);
              return (
                <button key={e.id} onClick={() => setDraft(e)} className="flex w-full gap-3 rounded-lg border border-border bg-card p-2.5 text-left hover:bg-muted">
                  <div className="flex w-10 shrink-0 flex-col items-center rounded-md py-0.5" style={{ backgroundColor: withAlpha(EVENT_KINDS[e.kind].color, 0.14) }}>
                    <span className="text-[10px] uppercase text-muted-foreground">{d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span>
                    <span className="text-base font-semibold tabular-nums text-foreground">{d.getDate()}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{e.title}</div>
                    <div className="text-xs text-muted-foreground">{EVENT_KINDS[e.kind].label} · {fmtEventTime(e)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {draft && <EventDialog initial={draft} onSave={save} onDelete={draft.id ? () => remove(draft) : undefined} onClose={() => setDraft(null)} />}
    </div>
  );
}

function EventDialog({ initial, onSave, onDelete, onClose }: { initial: Draft; onSave: (d: Draft) => void; onDelete?: () => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [allDay, setAllDay] = useState(initial.start_min === null);
  const [start, setStart] = useState(fmtTime(initial.start_min ?? 17 * 60));
  const [end, setEnd] = useState(fmtTime(initial.end_min ?? 18 * 60));
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  function pickKind(kind: EventKind) {
    // Holidays are naturally multi-day and all-day.
    if (kind === "holiday" && !initial.id) {
      setAllDay(true);
      set({ kind, reminder_min: null, end_date: toDateKey(addDays(fromDateKey(d.start_date), 13)) });
    } else set({ kind });
  }

  const s = parseTime(start);
  const e = parseTime(end);
  const valid = d.title.trim() !== "" && d.end_date >= d.start_date && (allDay || (s !== null && (e === null || e > s)));

  function submit() {
    if (!valid) return;
    onSave({ ...d, title: d.title.trim(), start_min: allDay ? null : s, end_min: allDay ? null : e });
  }

  return (
    <Dialog
      title={initial.id ? "Modifier l'évènement" : "Nouvel évènement"}
      onClose={onClose}
      className="max-w-lg"
      footer={
        <div className="flex w-full items-center">
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete} className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 size={14} /> Supprimer
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
            <Button size="sm" onClick={submit} disabled={!valid}>Enregistrer</Button>
          </div>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <div className="flex gap-1.5">
          {(Object.keys(EVENT_KINDS) as EventKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickKind(k)}
              className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors", d.kind === k ? "border-transparent font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted")}
              style={d.kind === k ? { backgroundColor: withAlpha(EVENT_KINDS[k].color, 0.16), boxShadow: `inset 0 0 0 1.5px ${EVENT_KINDS[k].color}` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_KINDS[k].color }} />
              {EVENT_KINDS[k].label}
            </button>
          ))}
        </div>

        <Input autoFocus value={d.title} onChange={(ev) => set({ title: ev.target.value })} placeholder={d.kind === "holiday" ? "Vacances de la Toussaint" : "Conseil d'école"} aria-label="Titre" />

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Du
            <Input type="date" value={d.start_date} onChange={(ev) => set({ start_date: ev.target.value, end_date: ev.target.value > d.end_date ? ev.target.value : d.end_date })} />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Au
            <Input type="date" value={d.end_date} min={d.start_date} onChange={(ev) => set({ end_date: ev.target.value })} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={allDay} onChange={(ev) => setAllDay(ev.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Toute la journée
          </label>
          {!allDay && (
            <div className="flex items-center gap-2">
              <Input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} className="w-28" aria-label="Début" />
              <span className="text-muted-foreground">→</span>
              <Input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} className="w-28" aria-label="Fin" />
            </div>
          )}
        </div>

        <label className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
          <Bell size={14} />
          <Select
            value={d.reminder_min === null ? "" : String(d.reminder_min)}
            onChange={(ev) => set({ reminder_min: ev.target.value === "" ? null : Number(ev.target.value) })}
            className="w-56"
            aria-label="Rappel"
          >
            {REMINDER_OPTIONS.map((o) => <option key={o.label} value={o.value === null ? "" : o.value}>{o.label}</option>)}
          </Select>
        </label>

        <Textarea value={d.notes} onChange={(ev) => set({ notes: ev.target.value })} placeholder="Lieu, ordre du jour, à préparer…" rows={3} aria-label="Notes" />
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
