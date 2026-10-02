// ─── Labour (group) punch: data access + access rules ─────────────────────────
// Backed by supabase/migrations/033_labour_attendance.sql — `labours` (roster),
// `labour_attendance` (append-only punch events) and `labour_punch_access` (who may punch which
// department's labours). Labours never log in: a user with access punches them from their own phone.
import { supabase } from "../supabase";
import { DEPTS } from "./deptClassify";
import { ATTENDANCE_QUIZ_DEPT_ICON } from "./attendance";

export const LABOUR_DEPTS = DEPTS;
// The quiz departments' icons, plus Transport (which has labours but no briefing).
export const DEPT_ICON = { ...ATTENDANCE_QUIZ_DEPT_ICON, Transport: "🚚" };

const isAdminUser = (u) => (u?.role || "").toLowerCase() === "admin" || u?.id === "u_admin";

/** Departments this user can grant/revoke labour-punch access for (and punch themselves).
 * Admin only (owner decision) — department heads get access the same way everyone else does, by an
 * Admin granting it. */
export function labourManageDepts(user) {
  return isAdminUser(user) ? [...DEPTS] : [];
}

/** Departments whose labours this user may punch: every one for Admin, else only those granted. */
export function labourPunchDepts(user, myAccessRows) {
  const out = new Set(labourManageDepts(user));
  (myAccessRows || []).forEach((r) => { if (r.user_id === user?.id && DEPTS.includes(r.department)) out.add(r.department); });
  return DEPTS.filter((d) => out.has(d));
}

const newId = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export const newLabourId = () => newId("lab");
export const newLabourPunchId = () => newId("latt");

// ── Roster ──
export async function fetchLabours(depts) {
  if (!depts?.length) return [];
  const { data, error } = await supabase.from("labours").select("*").in("department", depts).eq("active", true).order("name");
  if (error) throw error;
  return data || [];
}
export async function insertLabour(row) {
  const { data, error } = await supabase.from("labours").insert(row).select().single();
  if (error) throw error;
  return data;
}
/** Soft delete — punches keep pointing at the row, so history stays readable. */
export async function deactivateLabour(id) {
  const { error } = await supabase.from("labours").update({ active: false }).eq("id", id);
  if (error) throw error;
}

// ── Punches ──
/** Every punch for these departments on one day, oldest first. */
export async function fetchDayLabourPunches(dateStr, depts) {
  if (!depts?.length) return [];
  const { data, error } = await supabase.from("labour_attendance").select("*").eq("date", dateStr).in("department", depts).order("at", { ascending: true });
  if (error) throw error;
  return data || [];
}
/** Every department's labour punches between two dates (inclusive), oldest first — Admin's log. */
export async function fetchLabourPunchesRange(fromDate, toDate) {
  const { data, error } = await supabase.from("labour_attendance").select("*").gte("date", fromDate).lte("date", toDate).order("at", { ascending: true });
  if (error) throw error;
  return data || [];
}
/** The whole active roster, every department — Admin's log uses it to list who did NOT punch. */
export async function fetchAllActiveLabours() {
  const { data, error } = await supabase.from("labours").select("*").eq("active", true).order("name");
  if (error) throw error;
  return data || [];
}
export async function insertLabourPunch(row) {
  const { data, error } = await supabase.from("labour_attendance").insert(row).select().single();
  if (error) throw error;
  return data;
}

// ── Access ──
export async function fetchMyLabourAccess(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("labour_punch_access").select("*").eq("user_id", userId);
  if (error) throw error;
  return data || [];
}
export async function fetchLabourAccessForDepts(depts) {
  if (!depts?.length) return [];
  const { data, error } = await supabase.from("labour_punch_access").select("*").in("department", depts).order("granted_at");
  if (error) throw error;
  return data || [];
}
export async function grantLabourAccess({ userId, department, grantedBy }) {
  const { data, error } = await supabase.from("labour_punch_access")
    .upsert({ id: `lpa_${userId}_${department}`, user_id: userId, department, granted_by: grantedBy || null, granted_at: new Date().toISOString() }, { onConflict: "user_id,department" })
    .select().single();
  if (error) throw error;
  return data;
}
export async function revokeLabourAccess(id) {
  const { error } = await supabase.from("labour_punch_access").delete().eq("id", id);
  if (error) throw error;
}

/** Latest punch per labour from a day's oldest-first list → { [labourId]: row }. */
export function lastPunchByLabour(dayPunches) {
  const m = {};
  (dayPunches || []).forEach((p) => { m[p.labour_id] = p; });
  return m;
}
