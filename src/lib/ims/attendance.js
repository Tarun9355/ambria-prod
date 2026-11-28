// ─── Attendance: data access + pure helpers ────────────────────────────────────
// Backed by the `attendance` table (supabase/migrations/030_attendance.sql) — one row per punch
// EVENT (type 'in' | 'out'), never edited after it's written. "Today's status" is derived from
// today's rows rather than kept as a separate mutable column; see that migration's header for why.
import { supabase } from "../supabase";
import { userDepartments } from "./deptClassify";

// The build/support departments a punch-in briefing can be scoped to — kept in sync with the
// LABOUR_DEPTS list so every crew a supervisor can punch has its own briefing slot. Transport and
// ADD were added back (owner ask 2026-11-28) — drivers and ADD staff also get their own on-site
// quiz now, scoped to their own department.
export const ATTENDANCE_QUIZ_DEPTS = ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric", "ADD"];
export const ATTENDANCE_QUIZ_DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵", ADD: "🧰" };

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

// Row <-> object translation (migration 045: attendance_locations/attendance_training TABLES
// replacing the attendanceLocations/attendanceTrainingByDept settings keys). Give back the exact
// shapes resolvePunchLocation (above) and QuizSetupPanel.jsx already expect.
export function assembleAttendanceLocationsFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng) }));
}
export function assembleAttendanceTrainingByDeptFromRows(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    out[r.dept] = { videoUrl: r.video_url || "", questions: Array.isArray(r.questions) ? r.questions : [] };
  });
  return out;
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

// Last-second guard against a double-punch landing twice: before we write the row, re-read the
// user's most recent punch of the same day and bail out if its `type` already matches. A fast
// double-tap on Punch In (two tabs, the client-side `savingRef` not catching a re-render, or a
// retry after a realtime hiccup) used to produce two `in` events back-to-back, which then made
// `currentState` wrong until the end of the day. The guard is advisory — a race between the read
// and the write is still possible until proper RLS / a server-side unique index per (user_id,
// date, type, bucket) lands — but it closes the window from "always" to "once in a while".
export async function insertPunch(row) {
  if (row?.user_id && row?.date && row?.type) {
    const { data: last } = await supabase
      .from("attendance")
      .select("type, at")
      .eq("user_id", row.user_id)
      .eq("date", row.date)
      .order("at", { ascending: false })
      .limit(1);
    const prior = last?.[0];
    // Treat anything in the last 30 seconds of the SAME type as the one we're about to write as a
    // duplicate — a real toggle (in → out or out → in) is always a different type.
    if (prior && prior.type === row.type && (Date.now() - new Date(prior.at).getTime()) < 30000) {
      throw new Error("Already punched " + (row.type === "in" ? "in" : "out") + " a moment ago — the previous punch is already saved.");
    }
  }
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
// In-memory cache so a repeated call within the same minute reuses the last known position
// instead of re-waking the GPS — Labour Punch's own coords ref already does this, this covers
// the staff flow (prewarm → saving step → quick retake) with the same idea.
let _coordsCache = { at: 0, value: null };
// Last error code from the last attempt (1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE,
// 3 = TIMEOUT). The caller reads this to tell the user *why* location is missing — "Location
// unavailable" alone sent phones looking for a GPS problem that was often a permissions one.
let _coordsError = null;
export const getCoordsError = () => _coordsError;

// Known falsy for an offline / unsupported device, "denied" if permission has been refused, or
// null if we can't tell yet. Used to avoid even trying the GPS call when we already know it
// will fail with PERMISSION_DENIED — some mobile browsers (iOS Safari especially) still prompt
// on every call, which flashes a prompt the user already said no to.
export async function geolocationPermissionState() {
  if (!navigator.geolocation) return "unsupported";
  try {
    const p = await navigator.permissions.query({ name: "geolocation" });
    return p.state; // "granted" | "prompt" | "denied"
  } catch { return null; } // Safari pre-16 doesn't expose permissions.query for geolocation
}

export function getCurrentCoords() {
  return new Promise((resolve) => {
    _coordsError = null;
    if (!navigator.geolocation) { _coordsError = "unsupported"; resolve(null); return; }
    // A fresh fix from the last 60s is good enough: it is the SAME place for any practical
    // attendance punch. Beats paying the cold-GPS wake cost (which is what the old 3s wait kept
    // losing to).
    if (_coordsCache.value && (Date.now() - _coordsCache.at) < 60_000) {
      resolve(_coordsCache.value); return;
    }
    // Two-stage attempt: try the hardware GPS first (accurate but slow, often fails indoors)
    // for 8s, then fall back to network-based geolocation (WiFi / cell towers, less accurate but
    // responds in a second or two anywhere with data). Owner ask 2026-11-28: "Location unavailable
    // aayi" — the single high-accuracy attempt was failing indoors AND permission-denied was
    // reading the same as a GPS error. This path differentiates them so the UI can tell.
    const settle = (pos) => {
      const value = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      _coordsCache = { at: Date.now(), value };
      resolve(value);
    };
    // Permission denied is terminal — no point falling back to network geolocation, it needs the
    // same permission. Report it so the UI can say "enable location in the browser" instead of
    // the generic "unavailable".
    const onErr = (err, stage) => {
      if (err && err.code === 1 /* PERMISSION_DENIED */) { _coordsError = "denied"; resolve(null); return; }
      if (stage === "first") {
        navigator.geolocation.getCurrentPosition(
          settle,
          (err2) => { _coordsError = err2?.code === 1 ? "denied" : err2?.code === 3 ? "timeout" : "unavailable"; resolve(null); },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
        );
      } else {
        _coordsError = err?.code === 3 ? "timeout" : "unavailable";
        resolve(null);
      }
    };
    navigator.geolocation.getCurrentPosition(
      settle,
      (err) => onErr(err, "first"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
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
// Small in-memory cache keyed by rounded lat/lng (3 decimals ≈ 110m) so a busy morning with 40
// staff punching from the same gate makes at most one Nominatim call per gate per session, well
// inside OSM's 1-req/s/IP TOS limit (usage policy: https://operations.osmfoundation.org/policies/nominatim/).
// NOTE for prod: Nominatim's TOS also requires a real User-Agent identifying the application —
// browsers can't set that header (it's a forbidden header), so a proper fix is to proxy this
// through a Supabase Edge Function with a `User-Agent: Ambria-IMS/<ver> (ops@ambria.in)` header.
// Until then we rely on the browser-sent Referer and the cache below to stay under the rate limit;
// Accept-Language hint keeps result wording consistent.
const _geocodeCache = new Map();
export async function reverseGeocode(lat, lng) {
  const key = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
  if (_geocodeCache.has(key)) return _geocodeCache.get(key);
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`, {
      signal: ctrl.signal,
      headers: { "Accept-Language": "en-IN, en" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.address || {};
    const parts = [
      a.road || a.neighbourhood || a.suburb || a.hamlet,
      a.city || a.town || a.village || a.county,
    ].filter(Boolean);
    const out = parts.length ? parts.join(", ") : (data?.display_name || null);
    _geocodeCache.set(key, out);
    return out;
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

/** One day at a glance from its oldest-first punches (staff or labour rows — same shape): first
 * punch-in, final punch-out (null while still in / never punched out), whether that out was the
 * 18h auto-close, whether the day is still open, and hours worked (dayHours). */
export function daySummary(dayPunches) {
  const ps = dayPunches || [];
  const firstIn = ps.find((p) => p.type === "in");
  const last = ps[ps.length - 1];
  const out = last?.type === "out" ? last : null;
  return { inAt: firstIn?.at || null, outAt: out?.at || null, auto: !!out?.auto_closed, open: last?.type === "in", hours: dayHours(ps) };
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
    // Accepts either script — the punch-time quiz shows the Hindi translation alongside the
    // English original (see AttendanceTab.jsx), so an answer typed in Hindi must match too.
    const accepted = [...(q.acceptedAnswers || []), ...(q.acceptedAnswersHi || [])];
    return accepted.some((a) => norm(a) && norm(a) === norm(given));
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
