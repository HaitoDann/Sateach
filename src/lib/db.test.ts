import { beforeEach, describe, expect, it } from "vitest";
import { openSqlJsDriver } from "./sql";
import {
  attachDriver, createOneOffSession, createSlot, deleteDomain, deleteSlot, getDomains,
  getJournalDay, getSlots, getWeekSettings, saveDayNotes, saveSessionFields, saveWeekSettings,
} from "./db";
import { DEFAULT_DOMAINS } from "./domains";

// 2026-09-28 is a Monday (weekday 0).
const MONDAY = "2026-09-28";
const NEXT_MONDAY = "2026-10-05";

beforeEach(async () => {
  await attachDriver(await openSqlJsDriver());
});

describe("vault database", () => {
  it("seeds the 8 default domains once", async () => {
    const domains = await getDomains();
    expect(domains.map((d) => d.name)).toEqual(DEFAULT_DOMAINS.map((d) => d.name));
  });

  it("builds a journal day from the timetable, and keeps details per date", async () => {
    const [francais, maths] = await getDomains();
    const slotId = await createSlot({ day: 0, start_min: 510, end_min: 540, domain_id: maths.id, title: "Calcul mental" });
    await createSlot({ day: 0, start_min: 540, end_min: 600, domain_id: francais.id, title: "Lecture" });
    await createSlot({ day: 1, start_min: 510, end_min: 540, domain_id: maths.id, title: "Calcul mental" });

    const day = await getJournalDay(MONDAY, await getSlots());
    expect(day.sessions.map((s) => s.title)).toEqual(["Calcul mental", "Lecture"]);

    const calc = day.sessions[0];
    await saveSessionFields(MONDAY, calc, { objectives: "Tables de 2" });
    await saveSessionFields(MONDAY, calc, { materials: "Ardoises" }); // second save reuses the row

    const after = await getJournalDay(MONDAY, await getSlots());
    expect(after.sessions[0]).toMatchObject({ slotId, objectives: "Tables de 2", materials: "Ardoises", title: "Calcul mental" });

    // Another Monday starts blank.
    const next = await getJournalDay(NEXT_MONDAY, await getSlots());
    expect(next.sessions[0].objectives).toBe("");
  });

  it("hides a séance for one day only and adds one-off séances", async () => {
    const [, maths] = await getDomains();
    await createSlot({ day: 0, start_min: 510, end_min: 540, domain_id: maths.id, title: "Calcul mental" });
    const day = await getJournalDay(MONDAY, await getSlots());
    await saveSessionFields(MONDAY, day.sessions[0], { hidden: 1 });
    await createOneOffSession(MONDAY, { title: "Sortie musée", start_min: 480, end_min: 700, domain_id: null });

    const after = await getJournalDay(MONDAY, await getSlots());
    expect(after.sessions.map((s) => [s.title, s.hidden, s.oneOff])).toEqual([
      ["Sortie musée", false, true],
      ["Calcul mental", true, false],
    ]);
  });

  it("keeps written details when the séance is removed from the timetable", async () => {
    const [, maths] = await getDomains();
    const slotId = await createSlot({ day: 0, start_min: 510, end_min: 540, domain_id: maths.id, title: "Calcul mental" });
    const day = await getJournalDay(MONDAY, await getSlots());
    await saveSessionFields(MONDAY, day.sessions[0], { review: "Très bien" });

    await deleteSlot(slotId);
    const after = await getJournalDay(MONDAY, await getSlots());
    expect(after.sessions).toHaveLength(1);
    expect(after.sessions[0]).toMatchObject({ title: "Calcul mental", review: "Très bien", start_min: 510, domain_id: maths.id, oneOff: true });
  });

  it("turns séances of a deleted domain into hors-domaine séances", async () => {
    const [, maths] = await getDomains();
    await createSlot({ day: 0, start_min: 510, end_min: 540, domain_id: maths.id, title: "Calcul mental" });
    await deleteDomain(maths.id);
    expect((await getSlots())[0].domain_id).toBeNull();
    expect((await getDomains()).some((d) => d.id === maths.id)).toBe(false);
  });

  it("stores week settings and day notes", async () => {
    await saveWeekSettings({ days: [0, 1, 2, 3, 4], dayStart: 480, dayEnd: 990 });
    expect(await getWeekSettings()).toEqual({ days: [0, 1, 2, 3, 4], dayStart: 480, dayEnd: 990 });
    await saveDayNotes(MONDAY, "Réunion à 17h");
    await saveDayNotes(MONDAY, "Réunion à 17h30");
    expect((await getJournalDay(MONDAY, [])).notes).toBe("Réunion à 17h30");
  });
});
