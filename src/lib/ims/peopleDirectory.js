// ═══ Attendance → Manage People: staff (users, who log in and punch themselves) and labours (the roster a supervisor
// punches) in one list ═══ Owner ask 2026-11-28: "saare staffs labour sabki details ... add, delete, edit - kuch smart sa".
// Pure: the screen (AttendanceManagePanel.jsx) does the reads and writes.
import { userDepartments } from "./deptClassify";

const digits = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const isAdminUser = (u) => (u?.role || "").toLowerCase() === "admin" || u?.id === "u_admin";

/** One row per person: { key, kind: "staff" | "labour", id, name, phone, depts, role, username, active, isAdmin }. */
export function buildPeople(users, labours) {
  const staff = (users || []).filter(Boolean).map((u) => ({
    key: "u:" + u.id, kind: "staff", id: u.id, name: u.name || u.username || "—", phone: digits(u.phone), depts: userDepartments(u) || [],
    role: u.role || "", username: u.username || "", active: u.active !== false, isAdmin: isAdminUser(u),
  }));
  const lab = (labours || []).filter((l) => l && l.active !== false).map((l) => ({
    key: "l:" + l.id, kind: "labour", id: l.id, name: l.name || "—", phone: digits(l.phone), depts: l.department ? [l.department] : [],
    role: "", username: "", active: true, isAdmin: false,
  }));
  return [...staff, ...lab].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** Phones used by more than one row of the same kind (two labours on one number, two logins on one number). */
export function duplicatePhones(people) {
  const seen = new Map();
  (people || []).forEach((p) => { if (p.phone.length === 10) { const k = p.kind + "|" + p.phone; seen.set(k, (seen.get(k) || 0) + 1); } });
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/** The list as the filters ask: kind "all" | "staff" | "labour"; dept a department, "none" (no department) or "all";
 *  flag "noPhone" | "dupPhone" | ""; q matches name, phone, username or role. */
export function filterPeople(people, { kind = "all", dept = "all", flag = "", q = "" } = {}) {
  const dups = flag === "dupPhone" ? duplicatePhones(people) : null;
  const term = String(q || "").trim().toLowerCase();
  const tdig = term.replace(/\D/g, "");
  return (people || []).filter((p) => {
    if (kind !== "all" && p.kind !== kind) return false;
    if (dept === "none" ? p.depts.length > 0 : dept !== "all" && !p.depts.includes(dept)) return false;
    if (flag === "noPhone" && p.phone) return false;
    if (dups && !dups.has(p.kind + "|" + p.phone)) return false;
    if (term && !(p.name.toLowerCase().includes(term) || p.username.toLowerCase().includes(term) || p.role.toLowerCase().includes(term) || (tdig.length >= 3 && p.phone.includes(tdig)))) return false;
    return true;
  });
}

/** Counts for the chips: total / staff / labour, per department (a person of two departments counts in both), and the flags. */
export function peopleStats(people) {
  const byDept = {};
  let none = 0;
  (people || []).forEach((p) => { if (!p.depts.length) none++; p.depts.forEach((d) => { byDept[d] = (byDept[d] || 0) + 1; }); });
  const dups = duplicatePhones(people);
  return {
    total: (people || []).length,
    staff: (people || []).filter((p) => p.kind === "staff").length,
    labour: (people || []).filter((p) => p.kind === "labour").length,
    byDept, none,
    noPhone: (people || []).filter((p) => !p.phone).length,
    dupPhone: (people || []).filter((p) => dups.has(p.kind + "|" + p.phone)).length,
  };
}
