import { describe, it, expect } from "vitest";
import { catToDept, DEPTS, userDepartments, canSeeDept, canSeeProdDept, poolLabourDept, poolLabourDeptLabel, catToDeptStrict, makeSubcatDept } from "./deptClassify";

// This classifier decides which department EARNS a category's income (Deal Check → Dept Income,
// IMS → Dept Ops) as well as which heading a row files under in Deal Check → Transport. A silent
// change here moves money between departments in reporting, so the mappings are pinned.

describe("catToDept", () => {
  it("files a pedestal under Floral", () => {
    // Regression: neither stem matched any rule, so this fell through to the Structure catch-all and
    // 6 Mosaic Pedestals showed under 🏛️ Structure in the Transport tab.
    expect(catToDept("Pedestals")).toBe("Floral");
    expect(catToDept("Pedestal")).toBe("Floral");
    expect(catToDept("Mosaic Pedestal")).toBe("Floral");
  });

  it("keeps the mappings the Transport tab already relied on", () => {
    expect(catToDept("Truss")).toBe("Tenting");
    expect(catToDept("Chandelier")).toBe("Lighting");
    expect(catToDept("LED Light")).toBe("Lighting");
    expect(catToDept("Platform")).toBe("Tenting");
    expect(catToDept("Carpet")).toBe("Tenting");
    expect(catToDept("Draping")).toBe("Fabric");
    expect(catToDept("Sofa")).toBe("Furniture");
    expect(catToDept("Floral")).toBe("Floral");
    expect(catToDept("Flower Pattern")).toBe("Floral");
  });

  it("falls back to Structure for anything unrecognised", () => {
    expect(catToDept("Something Nobody Mapped")).toBe("Structure");
    expect(catToDept("")).toBe("Structure");
    expect(catToDept(null)).toBe("Structure");
    expect(catToDept(undefined)).toBe("Structure");
  });

  it("ignores case and surrounding space", () => {
    expect(catToDept("  PEDESTALS  ")).toBe("Floral");
    expect(catToDept("tRuSs")).toBe("Tenting");
  });

  it("lets the admin override beat every keyword", () => {
    // The override map is keyed by LOWERCASED category and is checked before the cascade.
    expect(catToDept("Truss", { truss: "Furniture" })).toBe("Furniture");
    expect(catToDept("Pedestals", { pedestals: "Structure" })).toBe("Structure");
  });

  it("ignores an override that is not a real department", () => {
    // A stale or hand-edited settings row must not invent a department the UI cannot show.
    expect(catToDept("Truss", { truss: "Nonsense" })).toBe("Tenting");
    expect(catToDept("Pedestals", { pedestals: "" })).toBe("Floral");
  });

  it("only ever returns a known department", () => {
    ["Pedestals", "Truss", "Chandelier", "Sofa", "Draping", "Mystery", ""].forEach((c) => {
      expect(DEPTS).toContain(catToDept(c));
    });
  });
});

// Owner ask, 2026-11-07: every department's shared Labours crew pools into Structure except
// Floral's. This decides which bucket a department's crew NEED gets ceiled under (manpowerCount.js,
// DealCheckOverlay.jsx, DepartmentOpsTab.jsx) — a silent change here moves real headcount/cost
// between departments (fewer, bigger pools ceil less often than many small ones), so pinned.
describe("poolLabourDept", () => {
  it("pools every department except Floral into Structure", () => {
    ["Structure", "Furniture", "Tenting", "Fabric", "Lighting", "Transport"].forEach((d) => {
      expect(poolLabourDept(d)).toBe("Structure");
    });
  });
  it("never pools Floral — it stays its own crew", () => {
    expect(poolLabourDept("Floral")).toBe("Floral");
  });
  it("only Structure and Floral are self-mapped (the pattern DepartmentOpsTab.jsx filters DEPTS by)", () => {
    const selfMapped = DEPTS.filter((d) => poolLabourDept(d) === d);
    expect(selfMapped.sort()).toEqual(["Floral", "Structure"]);
  });
});

describe("poolLabourDeptLabel", () => {
  it("lists every pooled department under Structure", () => {
    expect(poolLabourDeptLabel("Structure")).toBe("Structure, Furniture, Tenting, Fabric, Lighting & Transport");
  });
  it("leaves Floral (and anything else never passed in as the pool target) unchanged", () => {
    expect(poolLabourDeptLabel("Floral")).toBe("Floral");
  });
});

// The department-access gate this session added: does a user see a given department's data, and
// which departments a user "belongs to" at all. Every existing user (no `departments` field yet)
// must resolve exactly as Dept Ops' original role-name inference already did, or an upgrade
// silently locks someone out of data they could see yesterday.
describe("userDepartments", () => {
  it("infers a single department from a role name containing one, same as Dept Ops always did", () => {
    expect(userDepartments({ role: "Dept Head - Lighting" })).toEqual(["Lighting"]);
    expect(userDepartments({ role: "Dept Head - Furniture" })).toEqual(["Furniture"]);
  });

  it("is unrestricted (null) for a role that names no department", () => {
    expect(userDepartments({ role: "Admin" })).toBe(null);
    expect(userDepartments({ role: "Sales" })).toBe(null);
    expect(userDepartments({ role: "Purchase Manager" })).toBe(null);
    // "Painter" isn't one of the 7 DEPTS — same gap Dept Ops already had, not a new one.
    expect(userDepartments({ role: "Dept Head - Painter" })).toBe(null);
  });

  it("prefers an explicit departments array over the role-name guess", () => {
    expect(userDepartments({ role: "Dept Head - Lighting", departments: ["Lighting", "Fabric"] })).toEqual(["Lighting", "Fabric"]);
  });

  it("falls back to role inference when departments is missing or empty (every pre-existing user)", () => {
    expect(userDepartments({ role: "Dept Head - Floral", departments: [] })).toEqual(["Floral"]);
    expect(userDepartments({ role: "Dept Head - Floral", departments: undefined })).toEqual(["Floral"]);
  });
});

describe("canSeeDept", () => {
  it("lets Admin see every department regardless of anything else", () => {
    expect(canSeeDept({ role: "Admin", departments: ["Furniture"] }, "Lighting")).toBe(true);
    expect(canSeeDept({ id: "u_admin", role: "whatever" }, "Lighting")).toBe(true);
  });

  it("blocks a department-scoped user from a department they are not assigned", () => {
    expect(canSeeDept({ role: "Dept Head - Furniture" }, "Lighting")).toBe(false);
    expect(canSeeDept({ role: "Dept Head - Furniture" }, "Furniture")).toBe(true);
  });

  it("lets a multi-department user see every department they were explicitly granted", () => {
    const u = { role: "Dept Head - Furniture", departments: ["Furniture", "Lighting"] };
    expect(canSeeDept(u, "Furniture")).toBe(true);
    expect(canSeeDept(u, "Lighting")).toBe(true);
    expect(canSeeDept(u, "Fabric")).toBe(false);
  });

  it("lets an unrestricted user (Sales, Admin, an unmatched role) see everything", () => {
    expect(canSeeDept({ role: "Sales" }, "Lighting")).toBe(true);
    expect(canSeeDept({ role: "Purchase Manager" }, "Structure")).toBe(true);
  });

  it("never hides a row over a missing/unknown department — that's a data gap, not a restriction", () => {
    expect(canSeeDept({ role: "Dept Head - Furniture" }, null)).toBe(true);
    expect(canSeeDept({ role: "Dept Head - Furniture" }, "")).toBe(true);
  });
});

describe("canSeeProdDept", () => {
  it("maps a PROD_DEPTS spelling onto the canonical department a user is scoped to", () => {
    const u = { role: "Dept Head - Lighting" };
    expect(canSeeProdDept(u, "Lighting")).toBe(true);
    expect(canSeeProdDept(u, "Structural")).toBe(false); // maps to canonical "Structure"
    expect(canSeeProdDept({ role: "Dept Head - Structure" }, "Structural")).toBe(true);
    expect(canSeeProdDept({ role: "Dept Head - Structure" }, "Props")).toBe(true); // Props -> Structure too
  });

  it("never hides the departments with no canonical equivalent", () => {
    const u = { role: "Dept Head - Furniture" };
    expect(canSeeProdDept(u, "Painter & Production")).toBe(true);
    expect(canSeeProdDept(u, "Other")).toBe(true);
  });
});

describe("makeSubcatDept - a sub-category inherits its category's department (owner report 2026-11-11)", () => {
  const inv = [
    { cat: "Floral Decor", subCat: "Console Table" }, { cat: "Floral Decor", subCat: "Console Table" }, { cat: "Furniture", subCat: "Console Table" },
    { cat: "Flooring", subCat: "Carpet" }, { cat: "Decor", subCat: "Sofa" }, { cat: "Misc", subCat: "Widget" },
  ];
  const dept = makeSubcatDept(inv, {});
  it("no keyword on the sub-category: its items' commonest category decides (Cabinets Console -> Floral, not Structure)", () => {
    expect(dept("Console Table")).toBe("Floral");
    expect(dept("console table", "Furniture")).toBe("Furniture"); // the item's own category, when known, wins
  });
  it("the sub-category's own keyword still wins (Carpet in 'Flooring' -> Tenting, Sofa in 'Decor' -> Furniture)", () => {
    expect(dept("Carpet")).toBe("Tenting");
    expect(dept("Sofa")).toBe("Furniture");
  });
  it("an admin mapping of the sub-category wins over everything", () => {
    expect(makeSubcatDept(inv, { "console table": "Furniture" })("Console Table")).toBe("Furniture");
  });
  it("nothing to go on: Structure, as before", () => {
    expect(dept("Widget")).toBe("Structure");
    expect(dept("Unknown thing")).toBe("Structure");
  });
  it("catToDeptStrict: null instead of the catch-all", () => {
    expect(catToDeptStrict("Console Table", {})).toBeNull();
    expect(catToDeptStrict("Wooden Pillar", {})).toBe("Structure");
    expect(catToDeptStrict("Flower Bunch", {})).toBe("Floral");
  });
});