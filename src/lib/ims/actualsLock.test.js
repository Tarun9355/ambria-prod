import { describe, it, expect } from "vitest";
import { actualsEndDate, autoLockAt, actualsLockState, patchTouchesActuals, reopenActualsPatch, relockActualsPatch } from "./actualsLock";

const HOUR = 3600000;

describe("actualsEndDate", () => {
  it("picks the latest function date", () => {
    const eo = { date: "2026-11-04", functionsDetail: [{ date: "2026-11-04" }, { date: "2026-11-05" }] };
    expect(actualsEndDate(eo)).toBe("2026-11-05");
  });

  it("extends to a dismantle day one day past the last function, from manpowerDetail's own schedule", () => {
    const eo = {
      functionsDetail: [{ date: "2026-11-04" }],
      manpowerDetail: { Structure: [{ type: "Carpenters", schedule: [{ date: "2026-11-04" }, { date: "2026-11-05" }] }] },
    };
    expect(actualsEndDate(eo)).toBe("2026-11-05");
  });

  it("ignores a synthetic back-to-back-dismantle schedule key", () => {
    const eo = { manpowerDetail: { Tenting: [{ type: "Fabric Bangali", schedule: [{ date: "2026-11-04:btwdismantle" }, { date: "2026-11-04" }] }] } };
    expect(actualsEndDate(eo)).toBe("2026-11-04");
  });

  it("returns null with no dates at all", () => {
    expect(actualsEndDate({})).toBe(null);
  });
});

describe("autoLockAt", () => {
  it("lands at IST midnight-after-end-date plus the grace window", () => {
    const eo = { functionsDetail: [{ date: "2026-11-04" }] };
    const at = autoLockAt(eo, 12);
    // IST midnight starting 2026-11-05 is 2026-11-04T18:30:00Z; +12h grace = 2026-11-05T06:30:00Z.
    expect(new Date(at).toISOString()).toBe("2026-11-05T06:30:00.000Z");
  });

  it("is null when the booking has no dates", () => {
    expect(autoLockAt({}, 12)).toBe(null);
  });
});

describe("actualsLockState", () => {
  const eo = { functionsDetail: [{ date: "2026-11-04" }] }; // locks 2026-11-05T06:30:00Z with 12h grace
  const settings = { actualsLockGraceHours: 12 };

  it("is unlocked before the lock time", () => {
    const now = Date.parse("2026-11-05T06:00:00Z");
    expect(actualsLockState(eo, settings, now).locked).toBe(false);
  });

  it("locks at and after the lock time", () => {
    const now = Date.parse("2026-11-05T06:30:00Z");
    expect(actualsLockState(eo, settings, now).locked).toBe(true);
  });

  it("an active reopen overrides the lock", () => {
    const now = Date.parse("2026-11-06T00:00:00Z");
    const reopened = { ...eo, actualsLock: reopenActualsPatch(eo, { name: "Tarun" }, "fixed a typo") };
    const st = actualsLockState({ ...reopened, actualsLock: { ...reopened.actualsLock, reopenUntil: now + HOUR } }, settings, now);
    expect(st.locked).toBe(false);
    expect(st.reopened).toBe(true);
    expect(st.reopenedBy).toBe("Tarun");
  });

  it("an expired reopen falls back to locked", () => {
    const now = Date.parse("2026-11-06T00:00:00Z");
    const withLock = { ...eo, actualsLock: { reopenUntil: now - HOUR, reopenedBy: "Tarun" } };
    expect(actualsLockState(withLock, settings, now).locked).toBe(true);
  });

  it("relockActualsPatch ends an active reopen immediately", () => {
    // relockActualsPatch stamps its own wall-clock Date.now(), so the check below uses real time
    // too (a moment after) rather than the fixed 2026-11-06 used elsewhere in this block.
    const active = { reopenUntil: Date.now() + HOUR, reopenedBy: "Tarun", history: [] };
    const patched = relockActualsPatch({ actualsLock: active }, { name: "Anmol" });
    expect(actualsLockState({ ...eo, actualsLock: patched }, settings, Date.now() + 1000).locked).toBe(true);
    expect(patched.history[patched.history.length - 1].action).toBe("relock");
  });

  it("never locks a booking with no dates", () => {
    expect(actualsLockState({}, settings, Date.now()).locked).toBe(false);
  });
});

describe("patchTouchesActuals", () => {
  it("flags expenses, mandi and crew patch keys", () => {
    expect(patchTouchesActuals({ expenses: [] })).toBe(true);
    expect(patchTouchesActuals({ realMandi: 5000 })).toBe(true);
    expect(patchTouchesActuals({ mpDay: {} })).toBe(true);
  });

  it("leaves non-actuals patches (loaded, dispatch, trucks...) alone", () => {
    expect(patchTouchesActuals({ loaded: true })).toBe(false);
    expect(patchTouchesActuals({ mpSeen: { sig: "x" } })).toBe(false);
    expect(patchTouchesActuals(null)).toBe(false);
  });
});
