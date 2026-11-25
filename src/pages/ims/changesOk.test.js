import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventChanges } from "../../lib/ims/recentChanges";

// Owner ask 2026-11-20: an "OK" on "Changed in the last 48 hours" - a department head presses it and the list and the calendar's
// alert go for them; the PDF download no longer does that.
const src = readFileSync(resolve(__dirname, "DepartmentOpsTab.jsx"), "utf8").replace(/\r\n/g, "\n");

describe("Changed in the last 48 hours - OK", () => {
  it("the OK button marks this department's changes seen, for department heads of that department only", () => {
    const i = src.indexOf("✓ OK");
    expect(i).toBeGreaterThan(0);
    const block = src.slice(src.lastIndexOf("{isDeptHead && !onsiteOnly && myDepts.includes(dept) && (", i), i);
    expect(block).toContain("{isDeptHead && !onsiteOnly && myDepts.includes(dept) && (");
    expect(block).toContain("onClick={() => markChangesSeen([dept], Math.max(0, ...list.map((c) => Number(c.at) || 0)))}");
  });
  it("it sits in the banner's header, after the count", () => {
    const head = src.indexOf(">Changed in the last 48 hours</span>");
    expect(src.indexOf("✓ OK")).toBeGreaterThan(head);
    expect(src.indexOf("✓ OK") - head).toBeLessThan(1500);
  });
  it("the list is shut by default and its head opens it (owner ask 2026-11-25); OK does not toggle it", () => {
    expect(src).toContain("const [changesOpen, setChangesOpen] = useState(false);");
    const head = src.indexOf(">Changed in the last 48 hours</span>");
    const before = src.slice(src.lastIndexOf("aria-expanded={changesOpen}", head), head);
    expect(before).toContain('if (e.target?.closest?.("button")) return; setChangesOpen(o => !o);');
    expect(src.indexOf("{changesOpen && (<>", head)).toBeGreaterThan(head);
  });
  it("downloading the PDF no longer marks anything seen", () => {
    const a = src.indexOf("const exportPdf = async (");
    const body = src.slice(a, src.indexOf("const exportDeptPdf = ", a));
    expect(body).not.toMatch(/markChangesSeen\(/);
  });
  it("once seen, the changes up to then leave that department head's list (and so the banner and the calendar mark)", () => {
    const now = Date.now();
    const eo = { id: "E1", deptOps: { Floral: { changes: { mp: { at: now - 60000, by: "Anmol" } }, changesSeen: {} } } };
    expect(eventChanges(eo, [], now, undefined, "head1").length).toBe(1);
    const seen = { ...eo, deptOps: { Floral: { ...eo.deptOps.Floral, changesSeen: { head1: now } } } };
    expect(eventChanges(seen, [], now, undefined, "head1").length).toBe(0);
    expect(eventChanges(seen, [], now, undefined, "head2").length).toBe(1); // per person
    const later = { ...seen, deptOps: { Floral: { ...seen.deptOps.Floral, changes: { mp: { at: now + 1000, by: "Anmol" } } } } };
    expect(eventChanges(later, [], now + 2000, undefined, "head1").length).toBe(1); // a change after OK shows again
  });
});
