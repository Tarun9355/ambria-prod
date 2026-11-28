// ═══ Bulk staff import (IMS → Admin → Users & Roles → Import staff) ═══
// Owner ask 2026-11-28: put the vendor / labour contact sheet (Category, Sub_Category, S_No, Name, Mobile, Email) into
// Attendance, each person in the department of their sub-category, each with a login of their own so they can punch.
// Pure functions only: the screen (StaffImportModal.jsx) previews planStaffImport's result and creates the accounts.
import { deriveUsername } from "../auth";

// Departments that exist only for attendance (not one of Dept Ops' build departments in deptClassify.DEPTS). A user's
// `departments` may hold one of these; Attendance groups and filters by it like any other.
export const ATTENDANCE_ONLY_DEPTS = ["ADD"];

// The role every imported person gets: sees only Attendance (see staffRoleSettings).
export const STAFF_ROLE = "Labour";

// A plain CSV parser: quoted fields, "" inside quotes, commas and line breaks inside quotes, CRLF, a leading BOM.
// Returns one object per data row keyed by the header row's (trimmed) names; blank lines are skipped.
export function parseCsv(text) {
  const s = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const nonBlank = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!nonBlank.length) return [];
  const head = nonBlank[0].map((h) => String(h).trim());
  return nonBlank.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] != null ? String(r[i]) : ""])));
}

// Sub-category (else category) -> department(s). Owner's mapping, 2026-11-28: carpenter and painter are Furniture, a welder
// is Structure, "tenting , structure" is both, ADD / ADD Senior is its own attendance department. null = not recognised.
const RULES = [
  [/add/, ["ADD"]],
  [/tent.*struct|struct.*tent/, ["Tenting", "Structure"]],
  [/weld|वेल्ड/, ["Structure"]],
  [/carpent|paint/, ["Furniture"]],
  [/fabric|tailor/, ["Fabric"]],
  [/tent/, ["Tenting"]],
  [/struct/, ["Structure"]],
  [/flor|fnr/, ["Floral"]],
  [/light/, ["Lighting"]],
  [/transport|driver/, ["Transport"]],
  [/furniture/, ["Furniture"]],
];
export function deptsForCategory(subCategory, category) {
  for (const raw of [subCategory, category]) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) continue;
    // whole word for "add" so a word merely containing it (e.g. "ladder") never lands in ADD
    for (const [re, depts] of RULES) {
      if (re.source === "add" ? /(^|[^a-z])add([^a-z]|$)/.test(s) : re.test(s)) return depts;
    }
  }
  return null;
}

// "Kripashankar (कृपाशंकर)" -> "Kripashankar": the part a username is made from (the Hindi stays in the display name).
export const latinName = (name) => String(name || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
const digits = (p) => String(p || "").replace(/\D/g, "").slice(-10);

// A readable password, "{NamePrefix}-{4 chars}" - the same shape Users & Roles' own generator makes (no 0/O/1/I/l).
export function generatePassword(nameSeed, rand = Math.random) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const prefix = (latinName(nameSeed) || "User").replace(/\s+.*$/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 5) || "User";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(rand() * chars.length)];
  return `${prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase()}-${suffix}`;
}

/**
 * What importing these sheet rows would do, row by row, without doing it.
 * Each result: { line, name, username, phone, email, departments, category, status: "new" | "skip", reason, warning }.
 *   - skipped: no name; a phone that already belongs to a user; the same person listed again with no phone of their own
 *     (same name and departments as a row that has one - the sheet's second "Florist" list repeats the "floral" one).
 *   - warning (still imported): department not recognised (imported with none - set it in Users & Roles), or a phone shared
 *     with another row (two people giving one number).
 *   - username: from the Latin part of the name, made unique against existing users and this import (santosh, santosh2, ...).
 */
export function planStaffImport(rows, existingUsers = []) {
  const takenNames = new Set((existingUsers || []).map((u) => String(u?.username || "").toLowerCase()).filter(Boolean));
  const userByPhone = new Map();
  (existingUsers || []).forEach((u) => { const p = digits(u?.phone); if (p.length >= 10) userByPhone.set(p, u); });
  const pick = (r, ...keys) => { for (const k of keys) { const hit = Object.keys(r || {}).find((h) => h.trim().toLowerCase() === k); if (hit && String(r[hit]).trim()) return String(r[hit]).trim(); } return ""; };
  const base = (rows || []).map((r, i) => {
    const name = pick(r, "name").replace(/\s+/g, " ");
    const category = pick(r, "category");
    const sub = pick(r, "sub_category", "sub category", "subcategory");
    const depts = deptsForCategory(sub, category);
    return { line: i + 2, name, phone: digits(pick(r, "mobile", "phone")), email: pick(r, "email"), category: sub || category, departments: depts || [], unknownDept: !depts };
  });
  const keyOf = (b) => latinName(b.name).toLowerCase() + "|" + [...b.departments].sort().join(",");
  const withPhone = new Set(base.filter((b) => b.phone).map(keyOf));
  const phoneCount = new Map();
  base.forEach((b) => { if (b.phone) phoneCount.set(b.phone, (phoneCount.get(b.phone) || 0) + 1); });
  const seenNoPhone = new Set();
  return base.map((b) => {
    const out = { line: b.line, name: b.name, username: "", phone: b.phone, email: b.email, departments: b.departments, category: b.category, status: "new", reason: "", warning: "" };
    if (!b.name) return { ...out, status: "skip", reason: "No name" };
    const owner = b.phone && userByPhone.get(b.phone);
    if (owner) return { ...out, status: "skip", reason: `Already a user (${owner.name || owner.username})` };
    if (!b.phone) {
      const k = keyOf(b);
      if (withPhone.has(k)) return { ...out, status: "skip", reason: "Listed again (the same name has a phone above)" };
      if (seenNoPhone.has(k)) return { ...out, status: "skip", reason: "Listed twice" };
      seenNoPhone.add(k);
    }
    const stem = deriveUsername(latinName(b.name)) || "staff";
    let username = stem, n = 2;
    while (takenNames.has(username)) username = stem + n++;
    takenNames.add(username);
    const warnings = [];
    if (b.unknownDept) warnings.push(`Department not recognised for "${b.category || "-"}" - set it in Users & Roles`);
    if (b.phone && phoneCount.get(b.phone) > 1) warnings.push("Same phone as another row");
    if (!b.phone) warnings.push("No phone");
    return { ...out, username, warning: warnings.join(" · ") };
  });
}

// settings changes that make sure the Labour role exists and opens only Attendance (Attendance is on for every role;
// "dashboard" is Admin-only, so a tab list of just it leaves nothing else - the same starting point "Create role" uses).
// null when nothing needs changing.
export function staffRoleSettings(settings, rolesFallback) {
  const list = Array.isArray(settings?.rolesList) ? settings.rolesList : rolesFallback;
  const hasRole = (list || []).includes(STAFF_ROLE);
  const hasTabs = !!settings?.roleTabs?.[STAFF_ROLE];
  if (hasRole && hasTabs) return null;
  return {
    rolesList: hasRole ? list : [...(list || []), STAFF_ROLE],
    roleTabs: hasTabs ? settings.roleTabs : { ...(settings?.roleTabs || {}), [STAFF_ROLE]: { tabs: ["dashboard"], subTabs: {} } },
  };
}

// The usernames / passwords sheet handed to the admin after the import (UTF-8 with a BOM so Excel keeps the Hindi names).
export function credentialsCsv(results) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [["Name", "Username", "Password", "Phone", "Department", "Result"].join(",")];
  (results || []).forEach((r) => lines.push([r.name, r.username, r.password || "", r.phone, (r.departments || []).join(" + "), r.result || ""].map(esc).join(",")));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/**
 * The same sheet into the LABOUR roster (Attendance → Labour Punch: `labours`, no login - a supervisor punches them). Owner
 * decision 2026-11-28: a labour has one department, so a person of two ("tenting , structure") is added to each.
 * One result per (person, department): { line, name, phone, department, status: "new" | "skip", reason, warning }.
 *   - skipped: no name; department not recognised (a labour must have one); already on that department's roster (same phone,
 *     or same name when the sheet has no phone); the same person listed again with no phone of their own.
 */
export function planLabourImport(rows, existingLabours = []) {
  const pick = (r, ...keys) => { for (const k of keys) { const hit = Object.keys(r || {}).find((h) => h.trim().toLowerCase() === k); if (hit && String(r[hit]).trim()) return String(r[hit]).trim(); } return ""; };
  const onRoster = new Set();
  (existingLabours || []).forEach((l) => {
    if (l?.active === false) return;
    const d = String(l?.department || "");
    const p = digits(l?.phone);
    if (p.length >= 10) onRoster.add(d + "|p|" + p);
    onRoster.add(d + "|n|" + latinName(l?.name).toLowerCase());
  });
  const base = (rows || []).map((r, i) => {
    const name = pick(r, "name").replace(/\s+/g, " ");
    const category = pick(r, "category");
    const sub = pick(r, "sub_category", "sub category", "subcategory");
    return { line: i + 2, name, phone: digits(pick(r, "mobile", "phone")), category: sub || category, departments: deptsForCategory(sub, category) };
  });
  const keyOf = (b) => latinName(b.name).toLowerCase() + "|" + [...(b.departments || [])].sort().join(",");
  const withPhone = new Set(base.filter((b) => b.phone && b.departments).map(keyOf));
  const phoneCount = new Map();
  base.forEach((b) => { if (b.phone) phoneCount.set(b.phone, (phoneCount.get(b.phone) || 0) + 1); });
  const seenNoPhone = new Set();
  const out = [];
  base.forEach((b) => {
    const row = { line: b.line, name: b.name, phone: b.phone, category: b.category, department: "", status: "new", reason: "", warning: "" };
    if (!b.name) { out.push({ ...row, status: "skip", reason: "No name" }); return; }
    if (!b.departments) { out.push({ ...row, status: "skip", reason: `Department not recognised for "${b.category || "-"}"` }); return; }
    if (!b.phone) {
      const k = keyOf(b);
      if (withPhone.has(k)) { out.push({ ...row, department: b.departments.join(" + "), status: "skip", reason: "Listed again (the same name has a phone above)" }); return; }
      if (seenNoPhone.has(k)) { out.push({ ...row, department: b.departments.join(" + "), status: "skip", reason: "Listed twice" }); return; }
      seenNoPhone.add(k);
    }
    const warn = [];
    if (b.phone && phoneCount.get(b.phone) > 1) warn.push("Same phone as another row");
    if (!b.phone) warn.push("No phone");
    b.departments.forEach((d) => {
      const there = (b.phone && onRoster.has(d + "|p|" + b.phone)) || (!b.phone && onRoster.has(d + "|n|" + latinName(b.name).toLowerCase()));
      if (there) out.push({ ...row, department: d, status: "skip", reason: `Already on the ${d} list` });
      else out.push({ ...row, department: d, warning: warn.join(" · ") });
    });
  });
  return out;
}
