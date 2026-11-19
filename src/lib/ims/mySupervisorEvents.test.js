import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { samePerson, supervisorIdsOfUser, isMyEvent } from "./mySupervisorEvents";

const roster = [
  { id: "S1", name: "Raja", phone: "98100 11111", active: true },
  { id: "S2", name: "Sunil Kumar", phone: "+91 98100 22222", active: true },
  { id: "S3", name: "Pappu", phone: "", active: false },
];

describe("samePerson", () => {
  it("phones decide when both have ten digits (+91, spaces, dashes ignored)", () => {
    expect(samePerson({ name: "x", phone: "+91-98100-11111" }, { name: "y", phone: "9810011111" })).toBe(true);
    expect(samePerson({ name: "Raja", phone: "9810011111" }, { name: "Raja", phone: "9810099999" })).toBe(false);
  });
  it("names decide when a phone is missing (case and spacing ignored)", () => {
    expect(samePerson({ name: "  sunil   KUMAR ", phone: "" }, { name: "Sunil Kumar", phone: "9810022222" })).toBe(true);
    expect(samePerson({ name: "Raja" }, { name: "Raj" })).toBe(false);
  });
  it("nothing to compare is never a match", () => {
    expect(samePerson({}, {})).toBe(false);
    expect(samePerson(null, undefined)).toBe(false);
    expect(samePerson({ name: "", phone: "" }, { name: "", phone: "" })).toBe(false);
    expect(samePerson({ name: "Raja", phone: "123" }, { name: "Other", phone: "456" })).toBe(false);
  });
});

describe("supervisorIdsOfUser", () => {
  it("finds the roster row of the login", () => {
    expect(supervisorIdsOfUser({ name: "Raja", phone: "9810011111" }, roster)).toEqual(["S1"]);
    expect(supervisorIdsOfUser({ name: "S. Kumar", phone: "9810022222" }, roster)).toEqual(["S2"]);
  });
  it("a login that is not on the roster has none; bad input is safe", () => {
    expect(supervisorIdsOfUser({ name: "Nobody", phone: "9000000000" }, roster)).toEqual([]);
    expect(supervisorIdsOfUser(null, roster)).toEqual([]);
    expect(supervisorIdsOfUser({ name: "Raja" }, null)).toEqual([]);
  });
});

describe("isMyEvent", () => {
  const me = { name: "Raja", phone: "9810011111" };
  it("the event's picked supervisor is me", () => {
    expect(isMyEvent({ siteSupervisorId: "S1" }, me, roster)).toBe(true);
  });
  it("the event's picked supervisor is somebody else on the roster", () => {
    expect(isMyEvent({ siteSupervisorId: "S2", siteSupervisorName: "Raja" }, me, roster)).toBe(false);
  });
  it("no supervisor picked is nobody's", () => {
    expect(isMyEvent({ siteSupervisorId: null }, me, roster)).toBe(false);
    expect(isMyEvent({}, me, roster)).toBe(false);
    expect(isMyEvent(null, me, roster)).toBe(false);
  });
  it("a supervisor since removed from the roster still counts by the name / phone the event kept", () => {
    expect(isMyEvent({ siteSupervisorId: "S9", siteSupervisorName: "Raja", siteSupervisorPhone: "9810011111" }, me, roster)).toBe(true);
    expect(isMyEvent({ siteSupervisorId: "S9", siteSupervisorName: "Other", siteSupervisorPhone: "9000000000" }, me, roster)).toBe(false);
  });
  it("a login not on the roster sees no event of a roster supervisor", () => {
    expect(isMyEvent({ siteSupervisorId: "S1" }, { name: "Nobody", phone: "9000000000" }, roster)).toBe(false);
  });
});

// ── wiring in Dept Ops (source) ──
const src = readFileSync(resolve(__dirname, "../../pages/ims/DepartmentOpsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
describe("Dept Ops wiring for the Site-Supervisor-view-only role", () => {
  it("the event list is narrowed to my events only for that role and only while the button is on", () => {
    expect(src).toMatch(/\.filter\(\(\{ eo \}\) => !\(onsiteOnly && myOnly\) \|\| isMyEvent\(eo, authUser, supervisors\)\)/);
  });
  it("the My events button is drawn only for onsiteOnly", () => {
    const i = src.indexOf("My events ✓");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, i - 900), i)).toMatch(/\{onsiteOnly && \(\s*<button/);
  });
  it("the PDF language starts on Hindi for that role when nothing is stored, English otherwise", () => {
    expect(src).toMatch(/saved === "hi" \|\| saved === "en" \? saved : \(onsiteOnly \? "hi" : "en"\)/);
  });
  it("the all-departments and Floral PDF buttons are for onsiteOnly only, Floral only when the person can see Floral", () => {
    expect(src).toMatch(/\{onsiteOnly && dept !== PAINT && \(\s*<div className="flex flex-wrap/);
    expect(src).toMatch(/\{deptOptions\.includes\("Floral"\) && \(\s*<button type="button" onClick=\{downloadFloralPdf\}/);
  });
  it("Floral PDF from another department moves to Floral first and downloads that one department's book", () => {
    expect(src).toMatch(/const downloadFloralPdf = \(\) => \{ if \(dept === "Floral"\) exportDeptPdf\(\["Floral"\]\); else \{ setFloralPdfWanted\(true\); setDept\("Floral"\); \} \};/);
    expect(src).toMatch(/if \(!floralPdfWanted \|\| dept !== "Floral" \|\| !sel \|\| exporting\) return;/);
  });
});
