import type { Holiday, YearSettings } from "./types";
import { addDays, fromDateKey, toDateKey } from "./time";
import { isTauri } from "./platform";

// Official French school calendar (open data from the Ministry of Education).
// Fetched from the teacher's computer when she clicks « Remplir automatiquement ».

const API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records";

export interface CalendarRecord {
  description: string;
  start_date: string;
  end_date: string;
  zones: string;
  population?: string | null;
  annee_scolaire?: string;
}

/** The record dates are instants (e.g. 2026-10-16T22:00:00+00:00 = midnight in Paris). */
function parisDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** School year label for a rentrée date: 2026-09-01 → "2026-2027". */
export function schoolYearOf(dateKey: string): string {
  const d = fromDateKey(dateKey);
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/** Turn the official records of one zone into rentrée, holidays and last day of class. */
export function parseCalendar(records: CalendarRecord[], zone: "A" | "B" | "C"): Pick<YearSettings, "schoolStart" | "schoolEnd" | "holidays"> | null {
  const mine = records.filter((r) =>
    r.zones?.toLowerCase() === `zone ${zone.toLowerCase()}` && !(r.population ?? "").toLowerCase().includes("enseignant")
  );
  const seen = new Set<string>();
  let schoolStart = "";
  let schoolEnd = "";
  const holidays: Holiday[] = [];
  for (const r of mine) {
    const name = r.description.trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // one record per académie of the zone
    seen.add(key);
    const start = parisDay(r.start_date);
    const end = parisDay(r.end_date);
    if (key.includes("rentrée")) {
      schoolStart = start;
    } else if (key.includes("été")) {
      schoolEnd = toDateKey(addDays(fromDateKey(start), -1));
    } else {
      // end_date is the day classes resume → last day off is the day before.
      const last = end > start ? toDateKey(addDays(fromDateKey(end), -1)) : start;
      holidays.push({ name, start, end: last });
    }
  }
  if (!schoolStart && holidays.length === 0) return null;
  holidays.sort((a, b) => a.start.localeCompare(b.start));
  // Saturday classes end Friday evening: the official start is already the first day off.
  return { schoolStart, schoolEnd, holidays };
}

export async function fetchSchoolCalendar(schoolYear: string, zone: "A" | "B" | "C") {
  const where = `annee_scolaire="${schoolYear}" AND zones="Zone ${zone}"`;
  const url = `${API}?limit=100&select=${encodeURIComponent("description,start_date,end_date,zones,population,annee_scolaire")}&where=${encodeURIComponent(where)}`;
  const doFetch = isTauri() ? (await import("@tauri-apps/plugin-http")).fetch : window.fetch.bind(window);
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { results?: CalendarRecord[] };
  const parsed = parseCalendar(json.results ?? [], zone);
  if (!parsed) throw new Error(`le calendrier ${schoolYear} n'est pas encore publié pour la zone ${zone}`);
  return parsed;
}
