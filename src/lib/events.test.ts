import { beforeEach, describe, expect, it } from "vitest";
import { openSqlJsDriver } from "./sql";
import { addArchiveFile, attachDriver, deleteArchiveItem, getArchiveItems, getEvents, saveArchiveItem, saveEvent, saveSessionFields, getJournalDay, createSlot, getSlots } from "./db";
import { reminderAt } from "./events";

beforeEach(async () => {
  await attachDriver(await openSqlJsDriver());
});

describe("calendar", () => {
  it("returns events overlapping a range (multi-day holidays included)", async () => {
    await saveEvent({ title: "Toussaint", kind: "holiday", start_date: "2026-10-17", end_date: "2026-11-01", start_min: null, end_min: null, notes: "", reminder_min: null });
    await saveEvent({ title: "Conseil d'école", kind: "meeting", start_date: "2026-11-05", end_date: "2026-11-05", start_min: 1080, end_min: 1200, notes: "", reminder_min: 60 });
    expect((await getEvents("2026-10-20", "2026-10-20")).map((e) => e.title)).toEqual(["Toussaint"]);
    expect((await getEvents("2026-11-01", "2026-11-30")).map((e) => e.title)).toEqual(["Toussaint", "Conseil d'école"]);
  });

  it("computes reminder times", () => {
    const base = { id: "x", title: "", kind: "meeting" as const, start_date: "2026-11-05", end_date: "2026-11-05", notes: "", end_min: null };
    expect(reminderAt({ ...base, start_min: 18 * 60, reminder_min: 60 })).toEqual(new Date(2026, 10, 5, 17, 0));
    expect(reminderAt({ ...base, start_min: null, reminder_min: 24 * 60 })).toEqual(new Date(2026, 10, 4, 8, 0));
    expect(reminderAt({ ...base, start_min: 600, reminder_min: null })).toBeNull();
  });
});

describe("archive & validation", () => {
  it("stores courses and their files", async () => {
    const id = await saveArchiveItem({ domain_id: null, folder: "Fractions", title: "Découverte", level: "CM1", objectives: "", progression: "", materials: "", notes: "" });
    await addArchiveFile(id, "fiche.pdf", "Cours/Maths/fiche.pdf");
    expect((await getArchiveItems())[0]).toMatchObject({ title: "Découverte", folder: "Fractions" });
    const removed = await deleteArchiveItem(id);
    expect(removed.map((f) => f.rel_path)).toEqual(["Cours/Maths/fiche.pdf"]);
    expect(await getArchiveItems()).toEqual([]);
  });

  it("keeps faite / non faite per day", async () => {
    await createSlot({ day: 0, start_min: 510, end_min: 540, domain_id: null, title: "Calcul" });
    const [s] = (await getJournalDay("2026-09-28", await getSlots())).sessions;
    await saveSessionFields("2026-09-28", s, { done: 2 });
    expect((await getJournalDay("2026-09-28", await getSlots())).sessions[0].done).toBe(2);
  });
});
