// ═══ Post-event actuals lock ═══
// Once a booking's last scheduled day has passed (plus a grace window — Admin → Settings → Site
// Supervisors → `actualsLockGraceHours`, SETTINGS_DEFAULTS in constants.js), the real-world numbers
// anyone logged — Dept Ops' on-site expenses/mandi spend/crew held, and the Site tab's truck
// receiving + actual crew — freeze. Before that point ops is still "live"; after it, nobody should
// be able to quietly nudge a number nobody is watching any more.
//
// Deliberately NOT a stored boolean. The lock is recomputed from the booking's own dates every
// time, so moving a date in Studio un-/re-locks it correctly with nothing to remember to flip back.
// The ONLY thing ever written is an admin's REOPEN override (`eo.actualsLock`) — a lock an admin
// can lift for a correction, logged, and good for a fixed window rather than forever.

// Patch keys that count as "actuals" inside `event_orders.data.deptOps[dept]` — the exact set
// DepartmentOpsTab.jsx's `saveDept` and `src/lib/ims/deptCrew.js`'s patch builders already write
// for expenses, mandi spend, and on-site crew (mpDayPatch/shiftCountPatch/actualCrewPatch/etc, plus
// the legacy flat `mp` array and `mpOverrides`/`mpExtra` count-or-rate overrides). `mpSeen` is
// deliberately excluded — it just records that a plan was looked at, not an edit of one.
export const ACTUALS_DEPT_KEYS = ["expenses", "mandiLines", "mandiLinesByFn", "mandiLinesByFnMeta", "mandiLinesArchived", "realMandi", "mp", "mpOverrides", "mpExtra", "mpDay", "mpWin", "mpWinCount", "mpWinBasis"];

export function patchTouchesActuals(patch) {
  return !!patch && typeof patch === "object" && Object.keys(patch).some((k) => ACTUALS_DEPT_KEYS.includes(k));
}

// The latest calendar day this booking's actuals could still legitimately be entered for: every
// function date, the booking's own `date`, AND every department's own crew schedule — which already
// runs one day past the last function for the dismantle crew (DepartmentOpsTab's manpowerDetail,
// synced from Deal Check) — so the lock never lands before the dismantle day's own numbers can be
// typed in. Synthetic schedule keys some callers use internally (e.g. a `date:btwdismantle` marker
// for back-to-back functions with no real gap day) are skipped; they're never a real calendar date.
export function actualsEndDate(eo) {
  const dates = [];
  // eo.date, else eo.eventDate — the same two fields DepartmentOpsTab.jsx's own eventDate()
  // falls back through, so a booking that only ever had the older field set still locks.
  if (eo?.date) dates.push(String(eo.date).slice(0, 10));
  if (eo?.eventDate) dates.push(String(eo.eventDate).slice(0, 10));
  (Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []).forEach((f) => { if (f?.date) dates.push(String(f.date).slice(0, 10)); });
  const md = eo?.manpowerDetail;
  if (md && typeof md === "object") {
    Object.values(md).forEach((rows) => {
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        (Array.isArray(r?.schedule) ? r.schedule : []).forEach((d) => {
          if (d?.date && !String(d.date).includes(":")) dates.push(String(d.date).slice(0, 10));
        });
      });
    });
  }
  const sorted = dates.filter(Boolean).sort();
  return sorted.length ? sorted[sorted.length - 1] : null;
}

// IST midnight at the END of `dateStr` (the start of the next day), as an epoch-ms number. An
// explicit +05:30 offset so this doesn't depend on whatever timezone the device happens to be in.
function istMidnightAfter(dateStr) {
  const d = new Date(dateStr + "T00:00:00+05:30");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

// null (never locks) when the booking has no dates at all yet.
export function autoLockAt(eo, graceHours) {
  const end = actualsEndDate(eo);
  if (!end) return null;
  return istMidnightAfter(end) + Math.max(0, Number(graceHours) || 0) * 3600000;
}

const REOPEN_HOURS = 24; // how long an admin's "Reopen for editing" stays open before it needs doing again

// `now` defaults to Date.now() but takes an explicit value so one render computes one consistent
// answer everywhere it's checked (the UI banner and the write guards) rather than each call
// re-reading the clock a few ms apart.
export function actualsLockState(eo, settings, now = Date.now()) {
  const graceHours = Number(settings?.actualsLockGraceHours ?? 12);
  const at = autoLockAt(eo, graceHours);
  const ov = eo?.actualsLock || null;
  const reopenUntil = ov?.reopenUntil ?? null;
  const reopened = reopenUntil != null && now < reopenUntil;
  const locked = at != null && now >= at && !reopened;
  return {
    locked, autoLockAt: at, graceHours,
    reopened, reopenUntil,
    reopenedAt: ov?.reopenedAt || null, reopenedBy: ov?.reopenedBy || null, reason: ov?.reason || null,
  };
}

// Patch for `eo.actualsLock` — merge straight in (`{...eo, actualsLock: reopenActualsPatch(eo, ...)}`).
export function reopenActualsPatch(eo, user, reason) {
  const prev = eo?.actualsLock || {};
  const history = Array.isArray(prev.history) ? prev.history : [];
  const now = Date.now();
  const until = now + REOPEN_HOURS * 3600000;
  return {
    reopenUntil: until, reopenedAt: now, reopenedBy: user?.name || "—", reopenedById: user?.id || null, reason: reason || "",
    history: [...history, { action: "reopen", at: now, by: user?.name || "—", byId: user?.id || null, reason: reason || "", until }],
  };
}

// Ends an active reopen early ("Lock again now") — leaves the history intact.
export function relockActualsPatch(eo, user) {
  const prev = eo?.actualsLock || {};
  const history = Array.isArray(prev.history) ? prev.history : [];
  const now = Date.now();
  return {
    ...prev, reopenUntil: now,
    history: [...history, { action: "relock", at: now, by: user?.name || "—", byId: user?.id || null }],
  };
}
