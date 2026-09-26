/** A teaching domain (Mathématiques, Français…). Each has its own color and a
 *  weekly target volume the teacher can set. */
export interface Domain {
  id: string;
  name: string;
  color: string;
  position: number;
  /** Weekly target, in minutes (0 = no target). */
  target_minutes: number;
}

/** A séance of the weekly timetable (emploi du temps type). */
export interface Slot {
  id: string;
  /** 0 = lundi … 6 = dimanche. */
  day: number;
  start_min: number;
  end_min: number;
  /** null = hors domaine (récréation, cantine, accueil…), not counted in volumes. */
  domain_id: string | null;
  title: string;
}

/** Cahier journal row for one date. Either the detail of a timetable séance
 *  (slot_id set, null overrides inherit from the slot) or a one-off séance. */
export interface JournalEntry {
  id: string;
  date: string;
  slot_id: string | null;
  title: string | null;
  start_min: number | null;
  end_min: number | null;
  domain_id: string | null;
  objectives: string;
  progression: string;
  materials: string;
  review: string;
  hidden: number;
  done: number;
}

/** A séance as shown in the cahier journal: the timetable slot merged with
 *  that day's details. */
export interface DaySession {
  /** Stable React key. */
  key: string;
  /** The journal row to write to (existing, or the one to create). */
  entryId: string;
  slotId: string | null;
  /** True for a séance added only for this day. */
  oneOff: boolean;
  title: string;
  start_min: number;
  end_min: number;
  domain_id: string | null;
  objectives: string;
  progression: string;
  materials: string;
  review: string;
  hidden: boolean;
  done: boolean;
}

export interface WeekSettings {
  /** School days shown in the timetable (0 = lundi … 5 = samedi). */
  days: number[];
  /** Grid bounds, minutes since midnight. */
  dayStart: number;
  dayEnd: number;
}

export type EntryFields = Partial<
  Pick<JournalEntry, "title" | "start_min" | "end_min" | "domain_id" | "objectives" | "progression" | "materials" | "review" | "hidden" | "done">
>;

export type PageName = "timetable" | "journal" | "volumes" | "settings";
