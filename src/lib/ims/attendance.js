// ─── Attendance: data access + pure helpers ────────────────────────────────────
// Backed by the `attendance` table (supabase/migrations/030_attendance.sql) — one row per punch
// EVENT (type 'in' | 'out'), never edited after it's written. "Today's status" is derived from
// today's rows rather than kept as a separate mutable column; see that migration's header for why.
import { supabase } from "../supabase";
import { userDepartments } from "./deptClassify";

// The build departments a punch-in briefing can be scoped to — the 6 of deptClassify's 7 that
// actually run crews needing a safety/training briefing (Transport excluded by request: drivers
// don't get the same on-site punch-in quiz as a build crew).
export const ATTENDANCE_QUIZ_DEPTS = ["Furniture", "Floral", "Structure", "Tenting", "Lighting", "Fabric"];
export const ATTENDANCE_QUIZ_DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Lighting: "💡", Fabric: "🧵" };

/**
 * Which of the 6 quiz departments this punch belongs to — the one department a user has, when
 * they have exactly one AND it's one of the 6. Anyone with no department, more than one, or a
 * department outside the 6 (e.g. Transport) has no per-department briefing to run: same as no
 * video being configured at all, so the flow just skips it rather than guessing which one applies.
 */
// How close a punch has to be to a named location to count as "there" — a fixed radius (not
// per-location) because that's exactly what was asked for; revisit only if a location genuinely
// needs a different one (a much bigger site, say).
export const PUNCH_LOCATION_RADIUS_M = 300;

// Great-circle distance in metres between two lat/lng points (haversine) — accurate enough at
// the few-hundred-metre scale a punch-in geofence cares about; no need for anything fancier.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's mean radius, metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * The nearest admin-configured location within PUNCH_LOCATION_RADIUS_M of a captured position, or
 * null if none is close enough (or no coordinates were captured at all) — the caller shows
 * "Unknown location" for null while still saving the raw lat/lng, never dropping the punch itself.
 * @param {Array<{id, name, lat, lng}>} locations settings.attendanceLocations
 */
export function resolvePunchLocation(locations, lat, lng) {
  if (lat == null || lng == null) return null;
  let best = null, bestDist = Infinity;
  for (const loc of locations || []) {
    if (loc.lat == null || loc.lng == null) continue;
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (d <= PUNCH_LOCATION_RADIUS_M && d < bestDist) { best = loc; bestDist = d; }
  }
  return best;
}

export function attendanceQuizDept(authUser) {
  const depts = userDepartments(authUser);
  if (!Array.isArray(depts) || depts.length !== 1) return null;
  return ATTENDANCE_QUIZ_DEPTS.includes(depts[0]) ? depts[0] : null;
}

// Work-day key, business-local (browser local time — staff punch in from where they work).
// Deliberately not toISOString().slice(0,10): that's UTC, and would roll the date over hours
// before local midnight in IST.
export const todayStr = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const newPunchId = () => `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** This user's punch events for one work day, oldest first. Never a plain `select *` — see the
 * migration's header for the incident this scoping is deliberately avoiding. */
export async function fetchDayPunches(userId, dateStr) {
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("user_id", userId)
    .eq("date", dateStr)
    .order("at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function insertPunch(row) {
  const { data, error } = await supabase.from("attendance").insert(row).select().single();
  if (error) throw error;
  return data;
}

/** One user's punches across a whole calendar month (the "My Attendance" view), oldest first. */
export async function fetchMonthPunches(userId, year, month) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .order("at", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** EVERY user's punches on one day (inclusive range, but the admin log always passes the same
 * date twice) — the admin's "who came in when, who left when" log. Deliberately not filtered to
 * one user, unlike everything else in this file. */
export async function fetchRangePunches(fromDate, toDate) {
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Wraps navigator.geolocation in a promise that always resolves — never rejects, never blocks a
 * punch. No API, no permission, a timeout, an off GPS: all of it resolves null, same fail-open
 * principle as the camera and the video briefing elsewhere in this flow. */
export function getCurrentCoords() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

/**
 * Turns a position into a real place name — "Kartavya Path, New Delhi", not a bare "Unknown
 * location" — for a punch that's outside every named location's radius. Uses OpenStreetMap's
 * Nominatim: free, no API key or secret, so unlike this app's keyed integrations (Claude, Cloudinary,
 * …) it's called straight from the browser rather than through an Edge Function — there's nothing
 * here worth hiding server-side. A 5s-capped, best-effort lookup: any failure (offline, Nominatim
 * down, a malformed response) resolves null and the caller falls back to "Unknown location" — a
 * geocoding hiccup must never block a punch, same fail-open rule as everywhere else in this flow.
 * Prefers a short "street, area" form over Nominatim's full display_name, which reads more like a
 * postal address than a place label.
 */
export async function reverseGeocode(lat, lng) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.address || {};
    const parts = [
      a.road || a.neighbourhood || a.suburb || a.hamlet,
      a.city || a.town || a.village || a.county,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : (data?.display_name || null);
  } catch {
    return null;
  }
}

/** What to show for a punch's location — three distinct states, not two: a resolved name, a
 * position that just isn't near any configured location ("Unknown location", the raw lat/lng is
 * still on the row for anyone who needs to look), or no position at all ("Location unavailable" —
 * GPS was off, permission denied, or the device has no location API). */
export function punchLocationLabel(p) {
  if (p.location_name) return p.location_name;
  if (p.lat != null && p.lng != null) return "Unknown location";
  return "Location unavailable";
}

/** Currently in or out, from a day's punches so far (oldest-first). No rows, or the last one is
 * an 'out', means out. */
export function currentState(dayPunches) {
  const last = (dayPunches || [])[dayPunches.length - 1];
  return last?.type === "in" ? "in" : "out";
}

/** Human label for a punch row — never lets a system-forced close (see
 * supabase/migrations/031_attendance_auto_close.sql) read as if the person actually tapped out. */
export function punchLabel(p) {
  if (p.type === "in") return "Punched in";
  return p.auto_closed ? "Auto punched out" : "Punched out";
}

/** Groups a flat list of punch rows by their `date` field — {date: rows[]}, each list in whatever
 * order the query returned (fetchMonthPunches already asks for oldest-first). */
export function groupPunchesByDate(rows) {
  const map = {};
  (rows || []).forEach((r) => { (map[r.date] ||= []).push(r); });
  return map;
}

/** Hours actually worked in one day: sums each in→out pair. An unmatched trailing 'in' (still
 * punched in, or a forgotten punch-out) contributes nothing — there's no "out" time to measure
 * against yet, and guessing one would misreport real hours. */
export function dayHours(dayPunches) {
  let ms = 0, openAt = null;
  (dayPunches || []).forEach((p) => {
    if (p.type === "in") openAt = new Date(p.at).getTime();
    else if (p.type === "out" && openAt != null) { ms += new Date(p.at).getTime() - openAt; openAt = null; }
  });
  return ms / 3600000;
}

/**
 * A day's status from its punches — deliberately not the fuller "Half Day" / leave-aware picture a
 * payroll system would show: this app has no shift-length or holiday/weekly-off calendar anywhere,
 * so there's no honest way to tell a real absence apart from an approved leave or a company
 * holiday. 'absent' is therefore only ever a PAST day with zero punches — today is never asserted
 * absent while it's still in progress, and a future day is simply 'none' (nothing to judge yet).
 *   'closed'      — punched in AND out
 *   'in-progress' — punched in today, not out yet (the day isn't over — not the same as 'open')
 *   'open'        — punched in on a PAST day, never punched out that day
 *   'absent'      — a PAST day with no punches at all
 *   'none'        — today or a future day with no punches yet
 */
export function dayStatus(dayPunches, dateStr, today) {
  if (!dayPunches?.length) return dateStr < today ? "absent" : "none";
  const last = dayPunches[dayPunches.length - 1];
  if (last.type === "out") return "closed";
  return dateStr === today ? "in-progress" : "open";
}

// A question's `type` decides both the shape of its own correct-answer fields and the shape of
// the answer given for it in `gradeQuiz`'s `answers` map:
//   'single'      (default — questions saved before types existed are treated as this)
//                 correctIndex: number         | given: number (the picked option's index)
//   'multi'       correctIndexes: number[]     | given: number[] (every picked option's index)
//                 Exact match required — every correct option picked, no incorrect one.
//   'fill_blank'  acceptedAnswers: string[]    | given: string
//                 Matches if given equals ANY accepted answer, case/whitespace-insensitive —
//                 lets an admin list spelling variants instead of guessing one exact string.
//   'short_answer' (no correct-answer field)   | given: string
//                 Not machine-gradable for correctness — there's no way to validate free text
//                 automatically — so this only checks that something was actually written.
function isAnswerCorrect(q, given) {
  const type = q.type || "single";
  if (type === "single") return given === q.correctIndex;
  if (type === "multi") {
    const want = new Set(q.correctIndexes || []);
    const got = new Set(Array.isArray(given) ? given : []);
    if (want.size !== got.size) return false;
    for (const i of want) if (!got.has(i)) return false;
    return true;
  }
  if (type === "fill_blank") {
    const norm = (s) => String(s || "").trim().toLowerCase();
    return (q.acceptedAnswers || []).some((a) => norm(a) && norm(a) === norm(given));
  }
  if (type === "short_answer") return String(given || "").trim().length > 0;
  return false;
}

/**
 * Grades a set of answers against the admin-set questions — see isAnswerCorrect above for what
 * "correct" means per question type.
 * @param {Array<object>} questions
 * @param {Record<string, number|number[]|string>} answers questionId -> the given answer
 * @returns {{passed: boolean, wrongIds: string[]}} passed = every question answered correctly.
 */
export function gradeQuiz(questions, answers) {
  const wrongIds = (questions || [])
    .filter((q) => !isAnswerCorrect(q, answers[q.id]))
    .map((q) => q.id);
  return { passed: wrongIds.length === 0, wrongIds };
}
