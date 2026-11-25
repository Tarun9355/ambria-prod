import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { samePerson, supervisorIdsOfUser, isMyEvent, fixedAtVenue } from "./mySupervisorEvents";

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
  it("the calendar is narrowed to my functions only for that role and only while the button is on: my event, or a function at a venue I am fixed at", () => {
    expect(src).toContain("if (onsiteOnly && myOnly && !isMyEvent(eo, authUser, supervisors)");
    expect(src).toContain("&& !fixedAtVenue(authUser, fnForDate(eo, d)?.venue || eo.venue || \"\", settings, venuePlaces, supervisors, inhouseVenues.inhouse)) return;");
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
    expect(src).toMatch(/const downloadFloralPdf = \(\) => \{ if \(dept === "Floral"\) exportDeptPdf\(\["Floral"\]\); else \{ floralBackTo\.current = dept; setFloralPdfWanted\(true\); setDept\("Floral"\); \} \};/);
    // and back to the department they were on afterwards
    expect(src).toMatch(/finally\(\(\) => \{ const back = floralBackTo\.current; floralBackTo\.current = null; if \(back\) setDept\(back\); \}\)/);
    expect(src).toMatch(/if \(!floralPdfWanted \|\| dept !== "Floral" \|\| !sel \|\| exporting\) return;/);
  });
  it("that role keeps the department bar and its language toggle, but not the bar's Download PDF or Sync", () => {
    expect(src).toMatch(/\{!onsiteOnly && <button onClick=\{\(\) => \{ const allDepts = deptsWithWork\.length/);
    expect(src).toMatch(/\{!onsiteOnly && <PlanningSyncButton eventOrders=\{eventOrders\} onlyOrder=\{sel\} \/>\}/);
    expect(src).toMatch(/\{pickerSlot && createPortal\(/);
    expect(src).not.toMatch(/no department bar - no chips/);
  });
  it("that role stays on the planning view (the Inventory blocked tile lives there), with the Department Head / Site Supervisor switch hidden", () => {
    expect(src).toMatch(/const \[opsViewRaw, setOpsView\] = useState\("planning"\);/);
    expect(src).toMatch(/const opsView = opsViewRaw;/);
    expect(src).toMatch(/\{!onsiteOnly && \[\["planning", "Department Head", IconClipboard\]/);
  });
  it("in each department that role sees only the Inventory blocked tile: no production requests, fixed-venue stock, income or changes", () => {
    expect(src).toMatch(/\{opsView === "planning" && !onsiteOnly && <ProductionRequestsCard/);
    expect(src).toMatch(/\{!onsiteOnly && <FixedVenueStockCard/);
    expect(src).toMatch(/\{onsiteOnly \? null : deptIncome \? \(\(\) => \{/);
    expect(src).toContain('const list = deptChangesOf(sel.id).filter((c) => !onsiteOnly || c.section === "inv" || c.section === "mp");');
    expect(src).toMatch(/if \(!list\.length\) return null;/);
    expect(src).toMatch(/\]\.filter\(\(t\) => t && \(!onsiteOnly \|\| t\.k === "inv" \|\| t\.k === "mp"\)\)/);
  });
  it("that role sees the planning block (Inventory blocked + the Department Head's own Manpower plan tile) and the on-site cards (Receiving, Dismantle & routing) together", () => {
    expect(src).toMatch(/\{\(opsView === "planning" \|\| onsiteOnly\) && dept !== PAINT && \(<>/);
    expect(src).toMatch(/\{\(opsView === "onsite" \|\| onsiteOnly\) && dept !== PAINT && \(<>/);
  });
  it("each block's panel opens only for its own tiles, so no empty second panel shows for that role", () => {
    expect(src).toContain('className={modal && (!onsiteOnly || modal === "inv" || modal === "mp") ? PANEL_WRAP : "hidden"}');
    expect(src).toContain('className={modal && (!onsiteOnly || ["rcv", "route"].includes(modal)) ? PANEL_WRAP : "hidden"}');
    // the on-site crew tile is the Department Head's Manpower plan for that role, not a second crew screen
    expect(src).toContain('!onsiteOnly && mpRows.length > 0 && { k: "oscrew"');
  });
  it("the department starts on the first one they can see again (no Tenting default)", () => {
    expect(src).toMatch(/const \[dept, setDept\] = useState\(roleDept \|\| deptOptions\[0\] \|\| "Floral"\);/);
  });
  it("that role is never offered Paint (its view prints paint costs), everyone else keeps it as before", () => {
    expect(src).toContain("...(!onsiteOnly && (isAdmin || !myDepts || myDepts.includes(PAINT)) ? [PAINT] : [])]");
  });
});
// ── fixed venues: "My events" shows the functions at the venues a supervisor is fixed at ──
describe("fixedAtVenue", () => {
  const places = [{ id: "P1", name: "Exotica" }, { id: "P2", name: "Manaktala" }, { id: "V1", name: "Aura" }];
  const inhouse = [{ id: "V1", name: "Aura", propertyId: "P1" }];
  const sups = [
    { id: "S1", name: "Raja", phone: "9810011111", active: true, fixedVenues: ["P1"] },
    { id: "S2", name: "Sunil Kumar", phone: "9810022222", active: true, fixedVenues: ["P2"] },
    { id: "S3", name: "Pappu", phone: "9810033333", active: false, fixedVenues: ["P1"] },
    { id: "S4", name: "NoVenue", phone: "9810044444", active: true, fixedVenues: [] },
  ];
  const settings = {};
  const at = (user, venue) => fixedAtVenue(user, venue, settings, places, sups, inhouse);
  const raja = { name: "Raja", phone: "9810011111" };
  it("is true at the venue (or any of its sub-venues) the supervisor is fixed at, false elsewhere", () => {
    expect(at(raja, "Exotica")).toBe(true);
    expect(at(raja, "Ambria Exotica")).toBe(true);
    expect(at(raja, "Aura")).toBe(true); // a sub-venue counts under its property
    expect(at(raja, "Manaktala")).toBe(false);
  });
  it("another supervisor's venue is not mine; an inactive supervisor and one with no venue never match", () => {
    expect(at({ name: "Sunil Kumar", phone: "9810022222" }, "Manaktala")).toBe(true);
    expect(at({ name: "Sunil Kumar", phone: "9810022222" }, "Exotica")).toBe(false);
    expect(at({ name: "Pappu", phone: "9810033333" }, "Exotica")).toBe(false);
    expect(at({ name: "NoVenue", phone: "9810044444" }, "Exotica")).toBe(false);
  });
  it("a login that is not on the roster, an empty venue and bad input are false, never a throw", () => {
    expect(at({ name: "Nobody", phone: "9000000000" }, "Exotica")).toBe(false);
    expect(at(raja, "")).toBe(false);
    expect(at(raja, null)).toBe(false);
    expect(at(null, "Exotica")).toBe(false);
    expect(fixedAtVenue(raja, "Exotica", settings, [], sups, inhouse)).toBe(false);
    expect(fixedAtVenue(raja, "Exotica", settings, places, null, inhouse)).toBe(false);
  });
});

import { addedSupervisorsOf, withAddedSupervisors, isMyEvent as isMine } from "./mySupervisorEvents";
describe("several supervisors on one event (Add supervisor adds, never replaces)", () => {
  it("an older event's one supervisor reads as a list of one; none → []", () => {
    expect(addedSupervisorsOf({ siteSupervisorId: "S1", siteSupervisorName: "Raju", siteSupervisorPhone: "9" })).toEqual([{ id: "S1", name: "Raju", phone: "9" }]);
    expect(addedSupervisorsOf({})).toEqual([]);
  });
  it("writes the list and keeps the old single fields as its first entry; an empty list clears them", () => {
    const eo = withAddedSupervisors({ id: "E" }, [{ id: "S1", name: "Raju", phone: "1" }, { id: "S2", name: "Chandan", phone: "" }]);
    expect(eo).toMatchObject({ siteSupervisorId: "S1", siteSupervisorName: "Raju", siteSupervisorPhone: "1" });
    expect(addedSupervisorsOf(eo).map((s) => s.name)).toEqual(["Raju", "Chandan"]);
    expect(withAddedSupervisors(eo, [])).toMatchObject({ extraSupervisors: [], siteSupervisorId: null, siteSupervisorName: null });
    expect(addedSupervisorsOf(withAddedSupervisors(eo, []))).toEqual([]);
  });
  it("'My events': the second supervisor added is theirs too", () => {
    const roster = [{ id: "S1", name: "Raju", phone: "9000000001" }, { id: "S2", name: "Chandan", phone: "9000000002" }];
    const eo = withAddedSupervisors({ id: "E" }, [roster[0], roster[1]]);
    expect(isMine(eo, { name: "Chandan", phone: "9000000002" }, roster)).toBe(true);
    expect(isMine(eo, { name: "Manish", phone: "9000000003" }, roster)).toBe(false);
  });
});
