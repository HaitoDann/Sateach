import { describe, expect, it } from "vitest";
import { fmtDuration, fmtHours, fmtTime, parseDuration, parseTime, stepSchoolDay, toDateKey } from "./time";
import { computeVolumes } from "./domains";

describe("time helpers", () => {
  it("formats and parses clock times", () => {
    expect(fmtTime(510)).toBe("08:30");
    expect(parseTime("8h30")).toBe(510);
    expect(parseTime("13:05")).toBe(785);
    expect(parseTime("nope")).toBeNull();
  });

  it("formats durations the French way", () => {
    expect(fmtDuration(90)).toBe("1h30");
    expect(fmtDuration(120)).toBe("2h");
    expect(fmtDuration(45)).toBe("45 min");
    expect(fmtHours(45)).toBe("0h45");
    expect(fmtHours(-90)).toBe("−1h30");
  });

  it("parses lenient duration inputs", () => {
    expect(parseDuration("5h")).toBe(300);
    expect(parseDuration("5h30")).toBe(330);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("90min")).toBe(90);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("10")).toBe(600);
    expect(parseDuration("abc")).toBeNull();
  });

  it("skips non-school days", () => {
    // Friday 2026-10-02 → next school day is Monday 2026-10-05 (Mon/Tue/Thu/Fri week).
    expect(toDateKey(stepSchoolDay(new Date(2026, 9, 2), 1, [0, 1, 3, 4]))).toBe("2026-10-05");
    // Tuesday → Thursday (no Wednesday).
    expect(toDateKey(stepSchoolDay(new Date(2026, 8, 29), 1, [0, 1, 3, 4]))).toBe("2026-10-01");
  });
});

describe("computeVolumes", () => {
  const domains = [
    { id: "m", name: "Mathématiques", color: "#000", position: 0, target_minutes: 300 },
    { id: "f", name: "Français", color: "#000", position: 1, target_minutes: 600 },
    { id: "e", name: "EMC", color: "#000", position: 2, target_minutes: 0 },
  ];
  it("sums slots on active days only and flags gaps", () => {
    const slots = [
      { id: "1", day: 0, start_min: 510, end_min: 600, domain_id: "m", title: "" },
      { id: "2", day: 1, start_min: 510, end_min: 720, domain_id: "m", title: "" },
      { id: "3", day: 2, start_min: 510, end_min: 600, domain_id: "m", title: "" }, // Wednesday, inactive
      { id: "4", day: 0, start_min: 600, end_min: 1200, domain_id: "f", title: "" },
      { id: "5", day: 0, start_min: 600, end_min: 620, domain_id: null, title: "Récré" },
    ];
    const v = computeVolumes(domains, slots, [0, 1, 3, 4]);
    expect(v.map((x) => [x.domain.id, x.planned, x.status])).toEqual([
      ["m", 300, "ok"],
      ["f", 600, "ok"],
      ["e", 0, "none"],
    ]);
    const under = computeVolumes(domains, slots.slice(0, 1), [0]);
    expect(under[0]).toMatchObject({ planned: 90, delta: -210, status: "under" });
  });
});

import { computePeriods, holidayOn } from "./year";

describe("programmation", () => {
  const year = {
    zone: "A" as const,
    schoolStart: "2026-09-01",
    schoolEnd: "2026-12-18",
    holidays: [{ name: "Toussaint", start: "2026-10-17", end: "2026-11-01" }, { name: "Vide", start: "", end: "" }],
  };
  it("derives the périodes and their weeks from the holidays", () => {
    expect(computePeriods(year)).toEqual([
      { n: 1, start: "2026-09-01", end: "2026-10-16", weeks: 7 },
      { n: 2, start: "2026-11-02", end: "2026-12-18", weeks: 7 },
    ]);
    expect(holidayOn(year, "2026-10-20")?.name).toBe("Toussaint");
    expect(holidayOn(year, "2026-11-02")).toBeUndefined();
  });
});

import { parseCalendar, schoolYearOf } from "./schoolCalendar";

describe("calendrier scolaire officiel", () => {
  const rec = (description: string, start: string, end: string, zones = "Zone A", population = "-") =>
    ({ description, start_date: start, end_date: end, zones, population });
  it("reads rentrée, holidays (last day off) and summer from the open data", () => {
    const r = parseCalendar([
      rec("Rentrée scolaire des enseignants", "2026-08-30T22:00:00+00:00", "2026-08-30T22:00:00+00:00", "Zone A", "Enseignants"),
      rec("Rentrée scolaire des élèves", "2026-08-31T22:00:00+00:00", "2026-08-31T22:00:00+00:00", "Zone A", "Élèves"),
      rec("Vacances de la Toussaint", "2026-10-16T22:00:00+00:00", "2026-11-01T23:00:00+00:00"),
      rec("Vacances de la Toussaint", "2026-10-16T22:00:00+00:00", "2026-11-01T23:00:00+00:00"), // another académie
      rec("Vacances d'Hiver", "2027-02-05T23:00:00+00:00", "2027-02-21T23:00:00+00:00", "Zone C"),
      rec("Vacances de Noël", "2026-12-18T23:00:00+00:00", "2027-01-03T23:00:00+00:00"),
      rec("Vacances d'Été", "2027-07-02T22:00:00+00:00", "2027-08-31T22:00:00+00:00"),
    ], "A");
    expect(r).toEqual({
      schoolStart: "2026-09-01",
      schoolEnd: "2027-07-02",
      holidays: [
        { name: "Vacances de la Toussaint", start: "2026-10-17", end: "2026-11-01" },
        { name: "Vacances de Noël", start: "2026-12-19", end: "2027-01-03" },
      ],
    });
    expect(schoolYearOf("2026-09-01")).toBe("2026-2027");
    expect(schoolYearOf("2027-03-01")).toBe("2026-2027");
  });
});

import { periodWeeks } from "./year";

describe("semaines d'une période", () => {
  it("splits a période into S1…Sn", () => {
    const w = periodWeeks({ n: 1, start: "2026-09-01", end: "2026-10-16", weeks: 7 });
    expect(w.length).toBe(7);
    expect(w[0]).toEqual({ n: 1, start: "2026-09-01", end: "2026-09-04" });
    expect(w[6]).toEqual({ n: 7, start: "2026-10-12", end: "2026-10-16" });
  });
});
