import type { DaySession, JournalEntry, Slot } from "./types";

/** Deterministic id of the journal row detailing `slotId` on `date`, so two
 *  quick saves can never create two rows for the same séance. */
export function slotEntryId(slotId: string, date: string): string {
  return `${slotId}@${date}`;
}

/** Build the cahier journal of one day: the timetable séances of that weekday
 *  merged with the day's details, plus the one-off séances. Sorted by time. */
export function mergeDay(date: string, weekday: number, slots: Slot[], entries: JournalEntry[]): DaySession[] {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const entryBySlot = new Map<string, JournalEntry>();
  const standalone: JournalEntry[] = [];

  for (const e of entries) {
    const slot = e.slot_id ? slotById.get(e.slot_id) : undefined;
    if (slot && slot.day === weekday) entryBySlot.set(slot.id, e);
    else standalone.push(e);
  }

  const out: DaySession[] = [];

  for (const slot of slots) {
    if (slot.day !== weekday) continue;
    const e = entryBySlot.get(slot.id);
    out.push({
      key: slot.id,
      entryId: e?.id ?? slotEntryId(slot.id, date),
      slotId: slot.id,
      oneOff: false,
      title: e?.title ?? slot.title,
      start_min: e?.start_min ?? slot.start_min,
      end_min: e?.end_min ?? slot.end_min,
      domain_id: e && e.domain_id !== null ? e.domain_id : slot.domain_id,
      objectives: e?.objectives ?? "",
      progression: e?.progression ?? "",
      materials: e?.materials ?? "",
      review: e?.review ?? "",
      hidden: Number(e?.hidden ?? 0),
      prepId: e?.prep_id ?? null,
      done: Number(e?.done ?? 0),
    });
  }

  // One-off séances, and details whose séance was since moved to another day
  // (kept visible on the date they were written for, never lost).
  for (const e of standalone) {
    const slot = e.slot_id ? slotById.get(e.slot_id) : undefined;
    const start = e.start_min ?? slot?.start_min;
    const end = e.end_min ?? slot?.end_min;
    if (start == null || end == null) continue;
    out.push({
      key: e.id,
      entryId: e.id,
      slotId: null,
      oneOff: !slot,
      title: e.title ?? slot?.title ?? "",
      start_min: start,
      end_min: end,
      domain_id: e.domain_id ?? slot?.domain_id ?? null,
      objectives: e.objectives,
      progression: e.progression,
      materials: e.materials,
      review: e.review,
      hidden: Number(e.hidden),
      prepId: e.prep_id ?? null,
      done: Number(e.done),
    });
  }

  out.sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || a.title.localeCompare(b.title));
  return out;
}
