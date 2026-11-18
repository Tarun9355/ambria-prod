import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// rowToSupervisor / supervisorToRow, the REAL source out of IMS.jsx (module-level, not exported) - sliced and compiled, so these
// tests follow the shipped mapping, not a hand copy. supervisors.fixed_venues (migration 070): read only when the column came back,
// written only when the supervisor carries fixedVenues - a save must never name a column the database does not have yet.
const src = readFileSync(resolve(__dirname, "./IMS.jsx"), "utf8").replace(/\r\n/g, "\n");
const start = src.indexOf("const rowToSupervisor = ");
const end = src.indexOf("const rowToUser = ", start);
const fnSrc = src.slice(start, end);
// eslint-disable-next-line no-new-func
const { rowToSupervisor, supervisorToRow } = new Function(`${fnSrc}\nreturn { rowToSupervisor, supervisorToRow };`)();

describe("IMS supervisors <-> rows (fixed_venues, migration 070)", () => {
  it("the slice found both mappers", () => {
    expect(start).toBeGreaterThan(-1);
    expect(fnSrc).toContain("const supervisorToRow = ");
    expect(typeof rowToSupervisor).toBe("function");
    expect(typeof supervisorToRow).toBe("function");
  });

  it("a row from before the migration (no fixed_venues key) gives no fixedVenues at all", () => {
    const s = rowToSupervisor({ id: "S001", name: "Raja", phone: "7607225147", active: true });
    expect(s).toEqual({ id: "S001", name: "Raja", phone: "7607225147", active: true });
    expect("fixedVenues" in s).toBe(false);
  });

  it("a supervisor without fixedVenues writes no fixed_venues (pre-migration save, or a just-added supervisor)", () => {
    const row = supervisorToRow({ id: "S001", name: "Raja", phone: "1", active: true });
    expect("fixed_venues" in row).toBe(false);
    expect(row).toEqual({ id: "S001", name: "Raja", phone: "1", active: true });
  });

  it("editing a pre-migration supervisor's name/phone round-trips without ever naming the column", () => {
    const s = rowToSupervisor({ id: "S002", name: "Old", phone: "9", active: false });
    const row = supervisorToRow({ ...s, name: "New", phone: "8" });
    expect(row).toEqual({ id: "S002", name: "New", phone: "8", active: false });
  });

  it("with the column: round-trips the venue ids", () => {
    const dbRow = { id: "S003", name: "Manish", phone: "", active: true, fixed_venues: ["p_ex", "v_aura"] };
    const s = rowToSupervisor(dbRow);
    expect(s.fixedVenues).toEqual(["p_ex", "v_aura"]);
    expect(supervisorToRow(s)).toEqual(dbRow);
  });

  it("with the column but an empty / null value: fixedVenues [] (column exists - the picker turns on), written back as []", () => {
    expect(rowToSupervisor({ id: "a", fixed_venues: [] }).fixedVenues).toEqual([]);
    expect(rowToSupervisor({ id: "a", fixed_venues: null }).fixedVenues).toEqual([]);
    expect(supervisorToRow(rowToSupervisor({ id: "a", fixed_venues: null })).fixed_venues).toEqual([]);
  });

  it("a non-array fixedVenues in state is not written (only arrays are)", () => {
    expect("fixed_venues" in supervisorToRow({ id: "a", fixedVenues: "p_ex" })).toBe(false);
    expect("fixed_venues" in supervisorToRow({ id: "a", fixedVenues: null })).toBe(false);
  });

  it("defaults: missing name/phone -> null, active defaults to true", () => {
    expect(supervisorToRow({ id: "x" })).toEqual({ id: "x", name: null, phone: null, active: true });
  });

  it("rowToSupervisor tolerates a sparse row", () => {
    expect(() => rowToSupervisor({})).not.toThrow();
  });
});

// addSupervisor, the REAL source out of AdminSettingsTab.jsx (inside the component) - compiled with the roster injected.
// Its id is "S" + (roster length + 1): after a delete, that id can already belong to a live supervisor.
const adminSrc = readFileSync(resolve(__dirname, "./AdminSettingsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
const aStart = adminSrc.indexOf("  function addSupervisor() {");
const aEnd = adminSrc.indexOf("\n  }\n", aStart);
const addSrc = adminSrc.slice(aStart, aEnd + 4);
const runAdd = (roster) => {
  let out = null;
  // eslint-disable-next-line no-new-func
  new Function("supervisors", "setSupervisors", `${addSrc}\naddSupervisor();`)(roster, (next) => { out = next; });
  return out;
};

describe("Admin -> Supervisors: + Add Supervisor id", () => {
  it("the slice found addSupervisor", () => {
    expect(addSrc).toContain("function addSupervisor()");
  });
  it("first supervisor gets S001, then S002", () => {
    expect(runAdd([]).map((s) => s.id)).toEqual(["S001"]);
    expect(runAdd([{ id: "S001" }]).map((s) => s.id)).toEqual(["S001", "S002"]);
  });
  // CONFIRMED BUG (pre-existing, sharper now): S001,S002,S003 -> delete S002 -> add: the new one is "S003", the SAME id as a live
  // supervisor. IMS setSupervisors upserts it by id -> the real S003's row is overwritten with "New Supervisor" (name/phone lost),
  // and since the new object has no fixedVenues the upsert leaves fixed_venues alone: the blank supervisor inherits S003's venues.
  it("FIXED: a new supervisor never reuses a live supervisor's id after a delete", () => {
    const next = runAdd([{ id: "S001" }, { id: "S003", name: "Raja", fixedVenues: ["p_ex"] }]);
    const ids = next.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("the new supervisor carries no fixedVenues key (so its first upsert does not name fixed_venues; DB default '{}' applies)", () => {
    const [s] = runAdd([]);
    expect("fixedVenues" in s).toBe(false);
  });
});
