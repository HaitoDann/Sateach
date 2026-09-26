import type { CalendarEvent, EventKind } from "./types";
import { fmtTime, fromDateKey } from "./time";

export const EVENT_KINDS: Record<EventKind, { label: string; color: string }> = {
  meeting: { label: "Réunion", color: "#3b82f6" },
  holiday: { label: "Vacances", color: "#00a8a4" },
  event: { label: "Évènement", color: "#f08c1a" },
  other: { label: "Autre", color: "#8b5cf6" },
};

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Aucun rappel" },
  { value: 0, label: "Au début" },
  { value: 15, label: "15 min avant" },
  { value: 60, label: "1 h avant" },
  { value: 24 * 60, label: "La veille" },
  { value: 7 * 24 * 60, label: "Une semaine avant" },
];

export function fmtEventTime(e: CalendarEvent): string {
  const multi = e.end_date !== e.start_date;
  const d = (k: string) => fromDateKey(k).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  if (multi) return `du ${d(e.start_date)} au ${d(e.end_date)}`;
  if (e.start_min === null) return "toute la journée";
  return e.end_min !== null ? `${fmtTime(e.start_min)} – ${fmtTime(e.end_min)}` : fmtTime(e.start_min);
}

/** When the reminder of `e` should fire (null = none). All-day events use 8:00. */
export function reminderAt(e: CalendarEvent): Date | null {
  if (e.reminder_min === null) return null;
  const start = fromDateKey(e.start_date);
  start.setMinutes(e.start_min ?? 8 * 60);
  return new Date(start.getTime() - e.reminder_min * 60_000);
}
