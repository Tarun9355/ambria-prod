import { describe, it, expect } from "vitest";
import { parseCsv, deptsForCategory, latinName, generatePassword, planStaffImport, staffRoleSettings, credentialsCsv, STAFF_ROLE } from "./staffImport.js";

const SHEET = "﻿Category,Sub_Category,S_No,Name,Mobile,Email\r\n"
  + "Tailor,fabric,1,Kripashankar (कृपाशंकर),9005061885,k@gmail.com\r\n"
  + "Tent,tenting ,1,Basant Bengali (बंसन्त बंगाली),8810672257,\r\n"
  + "Florist,floral,1,Sunil (सुनील),7065441990,\r\n"
  + "Florist,Florist,2,sunil,,\r\n"
  + "ADD,ADD Senior,1,Mohit Senior (मोहित सीनियर),9000000001,\r\n"
  + "Carpenter,Welder (वेल्डर),1,Rahul Welder,9000000002,\r\n"
  + "Carpenter,Carpenter,2,Jitendra,9999760816,\r\n"
  + "Painter,Painter,1,\"Sharma, Manoj\",9000000003,\r\n"
  + "\"tenting , structure\",\"tenting , structure\",1,Akhilesh ,8882800214,\r\n"
  + "\"tenting , structure\",\"tenting , structure\",2,Shivam ,8882800214,\r\n"
  + "Light,Light,1,Kapil,9000000004,\r\n"
  + "transport,transport,1,Santosh,9389750485,\r\n"
  + "Tailor,fabric,2,Santosh,8976152651,\r\n"
  + "Misc,Cook,1,Ramu,9000000005,\r\n"
  + ",,,,,\r\n";

describe("parseCsv", () => {
  it("reads the sheet: BOM, CRLF, quoted commas, blank rows", () => {
    const rows = parseCsv(SHEET);
    expect(rows).toHaveLength(14);
    expect(rows[0].Name).toBe("Kripashankar (कृपाशंकर)");
    expect(rows[7].Name).toBe("Sharma, Manoj");
    expect(rows[8].Category).toBe("tenting , structure");
  });
  it("handles escaped quotes and an empty file", () => {
    expect(parseCsv('a,b\n"say ""hi""",2')).toEqual([{ a: 'say "hi"', b: "2" }]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("deptsForCategory (owner's mapping)", () => {
  it.each([
    ["fabric", "Tailor", ["Fabric"]], ["tenting ", "Tent", ["Tenting"]], ["floral", "Florist", ["Floral"]], ["Florist", "Florist", ["Floral"]],
    ["floral", "FNR", ["Floral"]], ["ADD", "ADD", ["ADD"]], ["ADD Senior", "ADD", ["ADD"]], ["Carpenter", "Carpenter", ["Furniture"]],
    ["Welder (वेल्डर)", "Carpenter", ["Structure"]], ["Painter", "Painter", ["Furniture"]], ["tenting , structure", "", ["Tenting", "Structure"]],
    ["Light", "Light", ["Lighting"]], ["transport", "transport", ["Transport"]],
  ])("%s / %s", (sub, cat, want) => expect(deptsForCategory(sub, cat)).toEqual(want));
  it("unknown is null; a word merely containing 'add' is not ADD", () => {
    expect(deptsForCategory("Cook", "Misc")).toBe(null);
    expect(deptsForCategory("ladder man", "")).toBe(null);
    expect(deptsForCategory("", "Light")).toEqual(["Lighting"]); // falls back to the category
  });
});

describe("planStaffImport", () => {
  const plan = planStaffImport(parseCsv(SHEET), [{ id: "u1", username: "kapil", name: "Kapil Old", phone: "+91 90000 00004" }]);
  const byName = (n) => plan.find((r) => r.name.startsWith(n));

  it("puts each person in their department with a unique username", () => {
    expect(byName("Kripashankar")).toMatchObject({ status: "new", username: "kripashankar", departments: ["Fabric"], phone: "9005061885" });
    expect(byName("Mohit Senior")).toMatchObject({ username: "mohit_senior", departments: ["ADD"] });
    expect(byName("Rahul Welder").departments).toEqual(["Structure"]);
    expect(byName("Akhilesh").departments).toEqual(["Tenting", "Structure"]);
    const santoshes = plan.filter((r) => r.name === "Santosh").map((r) => r.username);
    expect(santoshes).toEqual(["santosh", "santosh2"]);
    expect(byName("Sharma, Manoj").username).toBe("sharma_manoj");
  });
  it("skips the same person listed again without a phone, and a phone that is already a user", () => {
    expect(plan.find((r) => r.name === "sunil")).toMatchObject({ status: "skip" });
    expect(byName("Sunil (")).toMatchObject({ status: "new", username: "sunil" });
    expect(byName("Kapil")).toMatchObject({ status: "skip", reason: "Already a user (Kapil Old)" });
  });
  it("flags, but still imports, an unknown department and a shared phone", () => {
    expect(byName("Ramu")).toMatchObject({ status: "new", departments: [] });
    expect(byName("Ramu").warning).toMatch(/Department not recognised/);
    expect(byName("Shivam").warning).toMatch(/Same phone/);
    expect(byName("Akhilesh").warning).toMatch(/Same phone/);
  });
  it("never reuses an existing username", () => {
    const p = planStaffImport([{ Name: "Kapil", Sub_Category: "Light", Mobile: "9111111111" }], [{ username: "kapil", phone: "" }]);
    expect(p[0].username).toBe("kapil2");
  });
});

describe("helpers", () => {
  it("latinName keeps only the Latin part", () => {
    expect(latinName("Deena Nath (दीना नाथ)")).toBe("Deena Nath");
  });
  it("generatePassword is readable, from the Latin name", () => {
    expect(generatePassword("Kripashankar (कृपाशंकर)", () => 0)).toBe("Kripa-AAAA");
    expect(generatePassword("", () => 0)).toBe("User-AAAA");
  });
  it("staffRoleSettings adds the Labour role opening only Attendance, once", () => {
    const s = staffRoleSettings({ rolesList: ["Admin", "Sales"], roleTabs: { Sales: { tabs: [] } } }, []);
    expect(s.rolesList).toEqual(["Admin", "Sales", STAFF_ROLE]);
    expect(s.roleTabs[STAFF_ROLE]).toEqual({ tabs: ["dashboard"], subTabs: {} });
    expect(s.roleTabs.Sales).toEqual({ tabs: [] });
    expect(staffRoleSettings({ rolesList: ["Labour"], roleTabs: { Labour: { tabs: ["x"] } } }, [])).toBe(null);
    expect(staffRoleSettings({}, ["Admin"]).rolesList).toEqual(["Admin", STAFF_ROLE]);
  });
  it("credentialsCsv escapes and keeps Hindi (BOM)", () => {
    const csv = credentialsCsv([{ name: "Sharma, Manoj (मनोज)", username: "sharma_manoj", password: "Sharm-AB23", phone: "9", departments: ["Furniture"], result: "Created" }]);
    expect(csv.startsWith("﻿Name,Username,Password")).toBe(true);
    expect(csv).toContain('"Sharma, Manoj (मनोज)",sharma_manoj,Sharm-AB23,9,Furniture,Created');
  });
});
