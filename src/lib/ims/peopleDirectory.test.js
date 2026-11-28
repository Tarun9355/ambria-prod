import { describe, it, expect } from "vitest";
import { buildPeople, filterPeople, peopleStats, duplicatePhones } from "./peopleDirectory.js";

const users = [
  { id: "u_admin", name: "Tarun", role: "Admin", phone: "9999999999" },
  { id: "u1", name: "Krati", role: "Dept Head - Floral", phone: "+91 98111 11111" },
  { id: "u2", name: "Ajay", role: "Site Supervisor", departments: ["Tenting", "Structure"], phone: "" , username: "ajay"},
  { id: "u3", name: "Old", role: "Sales", active: false },
];
const labours = [
  { id: "l1", name: "Basant", phone: "8810672257", department: "Tenting", active: true },
  { id: "l2", name: "Akhilesh", phone: "8882800214", department: "Tenting", active: true },
  { id: "l3", name: "Shivam", phone: "8882800214", department: "Tenting", active: true },
  { id: "l4", name: "Gone", phone: "1", department: "Floral", active: false },
  { id: "l5", name: "Mohit Senior", phone: null, department: "ADD", active: true },
];
const people = buildPeople(users, labours);

describe("buildPeople", () => {
  it("staff and active labours in one sorted list", () => {
    expect(people.map((p) => p.name)).toEqual(["Ajay", "Akhilesh", "Basant", "Krati", "Mohit Senior", "Old", "Shivam", "Tarun"]);
    expect(people.find((p) => p.name === "Krati")).toMatchObject({ kind: "staff", depts: ["Floral"], phone: "9811111111" });
    expect(people.find((p) => p.name === "Tarun").isAdmin).toBe(true);
    expect(people.find((p) => p.name === "Old").active).toBe(false);
    expect(people.some((p) => p.name === "Gone")).toBe(false);
  });
});

describe("filterPeople", () => {
  it("by kind, department, no department", () => {
    expect(filterPeople(people, { kind: "labour" }).length).toBe(4);
    expect(filterPeople(people, { dept: "Tenting" }).map((p) => p.name)).toEqual(["Ajay", "Akhilesh", "Basant", "Shivam"]);
    expect(filterPeople(people, { dept: "none" }).map((p) => p.name)).toEqual(["Old", "Tarun"]);
  });
  it("search by name, username, role, or 3+ digits of the phone", () => {
    expect(filterPeople(people, { q: "supervisor" }).map((p) => p.name)).toEqual(["Ajay"]);
    expect(filterPeople(people, { q: "88106" }).map((p) => p.name)).toEqual(["Basant"]);
    expect(filterPeople(people, { q: "kr" }).map((p) => p.name)).toEqual(["Krati"]);
  });
  it("flags: no phone, a phone shared within the same kind", () => {
    expect(filterPeople(people, { flag: "noPhone" }).map((p) => p.name)).toEqual(["Ajay", "Mohit Senior", "Old"]);
    expect(filterPeople(people, { flag: "dupPhone" }).map((p) => p.name)).toEqual(["Akhilesh", "Shivam"]);
    expect(duplicatePhones(people).size).toBe(1);
  });
});

describe("peopleStats", () => {
  it("counts for the chips", () => {
    const s = peopleStats(people);
    expect(s).toMatchObject({ total: 8, staff: 4, labour: 4, none: 2, noPhone: 3, dupPhone: 2 });
    expect(s.byDept).toEqual({ Tenting: 4, Structure: 1, Floral: 1, ADD: 1 });
  });
});
