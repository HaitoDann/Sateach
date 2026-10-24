import type { Holiday, YearSettings } from "./types";
import { addDays, fromDateKey, toDateKey } from "./time";

export interface Period {
  n: number;
  start: string;
  end: string;
  /** School weeks (weeks containing at least one weekday of the period). */
  weeks: number;
}

/** Dates of the school year starting in September of the current school year. */
export function defaultYear(today = new Date()): YearSettings {
  const y = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    zone: "A",
    schoolStart: `${y}-09-01`,
    schoolEnd: `${y + 1}-07-03`,
    holidays: [
      { name: "Vacances de la Toussaint", start: "", end: "" },
      { name: "Vacances de Noël", start: "", end: "" },
      { name: "Vacances d'hiver", start: "", end: "" },
      { name: "Vacances de printemps", start: "", end: "" },
    ],
  };
}

export function validHolidays(y: YearSettings): Holiday[] {
  return y.holidays
    .filter((h) => h.start && h.end && h.end >= h.start)
    .sort((a, b) => a.start.localeCompare(b.start));
}

function schoolWeeks(start: string, end: string): number {
  if (!start || !end || end < start) return 0;
  const weeks = new Set<string>();
  for (let d = fromDateKey(start); toDateKey(d) <= end; d = addDays(d, 1)) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    weeks.add(toDateKey(addDays(d, -((wd + 6) % 7))));
  }
  return weeks.size;
}

/** The périodes: school days between the rentrée, each holiday and the end of
 *  the year (normally 5 périodes for 4 holidays). */
export function computePeriods(y: YearSettings): Period[] {
  if (!y.schoolStart || !y.schoolEnd) return [];
  const hol = validHolidays(y).filter((h) => h.end >= y.schoolStart && h.start <= y.schoolEnd);
  const out: Period[] = [];
  let start = y.schoolStart;
  for (const h of hol) {
    const end = toDateKey(addDays(fromDateKey(h.start), -1));
    if (end >= start) out.push({ n: out.length + 1, start, end, weeks: schoolWeeks(start, end) });
    start = toDateKey(addDays(fromDateKey(h.end), 1));
  }
  if (y.schoolEnd >= start) out.push({ n: out.length + 1, start, end: y.schoolEnd, weeks: schoolWeeks(start, y.schoolEnd) });
  return out;
}

export function holidayOn(y: YearSettings | null, date: string): Holiday | undefined {
  return y ? validHolidays(y).find((h) => h.start <= date && date <= h.end) : undefined;
}

export function periodOn(periods: Period[], date: string): Period | undefined {
  return periods.find((p) => p.start <= date && date <= p.end);
}
