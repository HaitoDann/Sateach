// Minutes-since-midnight helpers. Everything in the app is stored as integer
// minutes so durations add up exactly (no floating-point hours).

export const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const DAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** 510 → "08:30" */
export function fmtTime(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "08:30" → 510 (null if unparsable). */
export function parseTime(s: string): number | null {
  const m = /^(\d{1,2})[:hH](\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 24 || min > 59) return null;
  return Math.min(1440, h * 60 + min);
}

/** 90 → "1h30", 45 → "45 min", 120 → "2h", 0 → "0h". */
export function fmtDuration(min: number): string {
  const m = Math.round(Math.abs(min));
  const sign = min < 0 ? "−" : "";
  if (m === 0) return "0h";
  if (m < 60) return `${sign}${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${sign}${h}h${r ? String(r).padStart(2, "0") : ""}`;
}

/** Always "Xh" / "XhMM" (for tables where "45 min" would break alignment). */
export function fmtHours(min: number): string {
  const m = Math.round(Math.abs(min));
  const sign = min < 0 ? "−" : "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${sign}${h}h${String(r).padStart(2, "0")}`;
}

/** Lenient duration parser for the target inputs: "5h", "5h30", "5:30",
 *  "90min", "90", "1,5" (hours) → minutes. null if unparsable. */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return 0;
  let m = /^(\d+)(?:h|:)(\d{1,2})?$/.exec(t);
  if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  m = /^(\d+)(?:min|mn|m)$/.exec(t);
  if (m) return parseInt(m[1], 10);
  m = /^(\d+)[.,](\d+)$/.exec(t);
  if (m) return Math.round(parseFloat(`${m[1]}.${m[2]}`) * 60);
  m = /^(\d+)$/.exec(t);
  if (m) {
    const n = parseInt(m[1], 10);
    // A bare small number is hours ("5"), a large one minutes ("90").
    return n <= 24 ? n * 60 : n;
  }
  return null;
}

export function snap(min: number, step = 5): number {
  return Math.round(min / step) * step;
}

/** Local YYYY-MM-DD (never UTC, so "today" matches the teacher's clock). */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** "Jeudi 26 septembre 2026" */
export function fmtLongDate(d: Date): string {
  const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Next (dir = 1) or previous (dir = -1) date that is a school day. */
export function stepSchoolDay(from: Date, dir: 1 | -1, schoolDays: number[]): Date {
  if (schoolDays.length === 0) return addDays(from, dir);
  let d = addDays(from, dir);
  for (let i = 0; i < 7 && !schoolDays.includes(weekdayIndex(d)); i++) d = addDays(d, dir);
  return d;
}
