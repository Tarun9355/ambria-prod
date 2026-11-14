import { describe, it, expect } from "vitest";
import { classifyEntry, reqByDateFrom, planStudioBlocks, SRC_STUDIO_CARD, SRC_STUDIO_MANUAL, SRC_IMS_AUTOCONFIRM } from "./soldBlocksPlan.js";

const EO = "eo_1";
const D = "2026-11-25";
const NOW = 1700000000000;

describe("classifyEntry", () => {
  it("a different event's entry is always foreign, regardless of source", () => {
    expect(classifyEntry({ eventId: "eo_other", source: SRC_STUDIO_CARD }, EO)).toBe("foreign");
  });
  it("studio-incremental is card", () => {
    expect(classifyEntry({ eventId: EO, source: SRC_STUDIO_CARD }, EO)).toBe("card");
  });
  it("studio-manual is manual", () => {
    expect(classifyEntry({ eventId: EO, source: SRC_STUDIO_MANUAL }, EO)).toBe("manual");
  });
  it("undefined, null, empty-string and ims-autoconfirm are all adoptable", () => {
    expect(classifyEntry({ eventId: EO }, EO)).toBe("adoptable");
    expect(classifyEntry({ eventId: EO, source: null }, EO)).toBe("adoptable");
    expect(classifyEntry({ eventId: EO, source: "" }, EO)).toBe("adoptable");
    expect(classifyEntry({ eventId: EO, source: SRC_IMS_AUTOCONFIRM }, EO)).toBe("adoptable");
  });
  it("ims-manual and amend are protected", () => {
    expect(classifyEntry({ eventId: EO, source: "ims-manual" }, EO)).toBe("protected");
    expect(classifyEntry({ eventId: EO, source: "amend" }, EO)).toBe("protected");
  });
  it("an unrecognised source is also protected, never assumed safe", () => {
    expect(classifyEntry({ eventId: EO, source: "something-new" }, EO)).toBe("protected");
  });
});

describe("reqByDateFrom", () => {
  it("takes the max across two functions sharing a date, not the sum", () => {
    const fns = [{ fnIdx: 0, fnDate: D }, { fnIdx: 1, fnDate: D }];
    const req = { 0: { X: 4 }, 1: { X: 12 } };
    expect(reqByDateFrom(fns, req)).toEqual({ [D]: { X: 12 } });
  });
  it("drops zero/negative quantities", () => {
    const fns = [{ fnIdx: 0, fnDate: D }];
    expect(reqByDateFrom(fns, { 0: { X: 0, Y: -1 } })).toEqual({ [D]: {} });
  });
  it("a function with no date contributes nothing", () => {
    expect(reqByDateFrom([{ fnIdx: 0, fnDate: "" }], { 0: { X: 4 } })).toEqual({});
  });
});

describe("planStudioBlocks — the Harpal Singh scenario: a card entry dropped from the build", () => {
  const base = { eventId: EO, processedDates: new Set([D]), liveDates: new Set([D]), legacyScopeIds: new Set(["T"]), manualReady: false, freezeCard: false, now: NOW };

  it("releases a studio-incremental entry when the current card requirement is zero", () => {
    const rowsById = new Map([["T", [{ date: D, eventId: EO, qty: 8, status: "confirmed", createdAt: 1, source: SRC_STUDIO_CARD }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {} });
    expect(r.changedIds).toEqual(["T"]);
    expect(r.nextById.get("T")).toEqual([]);
    expect(r.log.released).toEqual([{ id: "T", date: D, qty: 8, source: SRC_STUDIO_CARD }]);
  });

  it("a second run on the already-released result is a no-op (idempotent)", () => {
    const rowsById = new Map([["T", []]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {} });
    expect(r.changedIds).toEqual([]);
  });

  it("releasing does not depend on functions.items still listing the item — only on the ledger itself", () => {
    // Simulates: functions.items has ALREADY dropped T (a separate, already-working resync), but the
    // blocks ledger still holds the stale entry. The planner must still find and release it from the
    // ledger alone, with no dependency on any client-side cache.
    const rowsById = new Map([["T", [{ date: D, eventId: EO, qty: 8, status: "confirmed", createdAt: 1, source: SRC_STUDIO_CARD }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {} });
    expect(r.nextById.get("T")).toEqual([]);
  });
});

describe("planStudioBlocks — protected and adoptable categories are never wrongly released", () => {
  const base = { eventId: EO, processedDates: new Set([D]), liveDates: new Set([D]), legacyScopeIds: new Set(["T"]), manualReady: false, freezeCard: false, now: NOW };

  it("an untagged legacy entry on a processed date with zero card need is kept, not released", () => {
    const rowsById = new Map([["T", [{ date: D, eventId: EO, qty: 2, status: "confirmed", createdAt: 1 }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {} });
    expect(r.changedIds).toEqual([]);
    expect(r.nextById.has("T")).toBe(false);
  });

  it("an ims-manual entry survives even when the card requirement for the same item/date is positive — a separate card entry is added alongside it", () => {
    const rowsById = new Map([["T", [{ date: D, eventId: EO, qty: 5, status: "confirmed", createdAt: 1, source: "ims-manual" }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: { [D]: { T: 3 } }, manualReq: {} });
    expect(r.changedIds).toEqual(["T"]);
    const next = r.nextById.get("T");
    expect(next).toContainEqual({ date: D, eventId: EO, qty: 5, status: "confirmed", createdAt: 1, source: "ims-manual" });
    expect(next).toContainEqual({ date: D, eventId: EO, qty: 3, status: "confirmed", createdAt: NOW, source: SRC_STUDIO_CARD });
  });

  it("an amend entry is kept no matter what the card requirement is", () => {
    const entry = { date: D, eventId: EO, qty: 1, status: "held", createdAt: 1, source: "amend", amendId: "r1" };
    const rowsById = new Map([["T", [entry]]]);
    const r1 = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {} });
    expect(r1.nextById.has("T") ? r1.nextById.get("T") : [entry]).toContainEqual(entry);
    const r2 = planStudioBlocks({ ...base, rowsById, cardReq: { [D]: { T: 9 } }, manualReq: {} });
    const next2 = r2.nextById.get("T");
    expect(next2).toContainEqual(entry);
  });

  it("an untagged entry and an ims-autoconfirm entry on the same item/date both adopt into exactly one studio-incremental entry when card need is positive", () => {
    const rowsById = new Map([["T", [
      { date: D, eventId: EO, qty: 2, status: "confirmed", createdAt: 1 },
      { date: D, eventId: EO, qty: 2, status: "confirmed", createdAt: 2, source: SRC_IMS_AUTOCONFIRM },
    ]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: { [D]: { T: 4 } }, manualReq: {} });
    const next = r.nextById.get("T");
    expect(next).toEqual([{ date: D, eventId: EO, qty: 4, status: "confirmed", createdAt: NOW, source: SRC_STUDIO_CARD }]);
    expect(r.log.adopted.length).toBe(2);
  });

  it("an untagged entry on a dead date (no live function uses it) is released when its id is in legacyScopeIds", () => {
    const rowsById = new Map([["T", [{ date: "2026-01-01", eventId: EO, qty: 2, status: "confirmed", createdAt: 1 }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {}, liveDates: new Set([D]) });
    expect(r.nextById.get("T")).toEqual([]);
  });

  it("an untagged entry on a dead date is kept when its id is NOT in legacyScopeIds (never seen before, not guessed at)", () => {
    const rowsById = new Map([["Z", [{ date: "2026-01-01", eventId: EO, qty: 2, status: "confirmed", createdAt: 1 }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {}, liveDates: new Set([D]), legacyScopeIds: new Set() });
    expect(r.changedIds).toEqual([]);
  });

  it("entries from another event are never touched, whatever their source or date", () => {
    const rowsById = new Map([["T", [{ date: D, eventId: "eo_other", qty: 999, status: "confirmed", createdAt: 1, source: SRC_STUDIO_CARD }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {} });
    expect(r.changedIds).toEqual([]);
  });
});

describe("planStudioBlocks — partial runs and live-but-unprocessed dates", () => {
  const base = { eventId: EO, legacyScopeIds: new Set(["T"]), manualReady: false, freezeCard: false, now: NOW };

  it("a card entry on a date that is live but wasn't processed this run is left untouched, not released", () => {
    const otherDate = "2026-12-01";
    const rowsById = new Map([["T", [{ date: otherDate, eventId: EO, qty: 6, status: "confirmed", createdAt: 1, source: SRC_STUDIO_CARD }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {}, processedDates: new Set([D]), liveDates: new Set([D, otherDate]) });
    expect(r.changedIds).toEqual([]);
  });

  it("a card entry on a genuinely dead date (not live anywhere) is released even if not processed", () => {
    const deadDate = "2026-01-01";
    const rowsById = new Map([["T", [{ date: deadDate, eventId: EO, qty: 6, status: "confirmed", createdAt: 1, source: SRC_STUDIO_CARD }]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: {}, processedDates: new Set([D]), liveDates: new Set([D]) });
    expect(r.nextById.get("T")).toEqual([]);
  });
});

describe("planStudioBlocks — stability and dedup", () => {
  const base = { eventId: EO, processedDates: new Set([D]), liveDates: new Set([D]), legacyScopeIds: new Set(["T"]), manualReady: false, freezeCard: false, now: NOW };

  it("an unchanged qty produces no write and keeps the original createdAt", () => {
    const entry = { date: D, eventId: EO, qty: 4, status: "confirmed", createdAt: 42, source: SRC_STUDIO_CARD };
    const rowsById = new Map([["T", [entry]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: { [D]: { T: 4 } }, manualReq: {} });
    expect(r.changedIds).toEqual([]);
  });

  it("two card entries on the same date (a pre-existing duplicate) collapse into one", () => {
    const rowsById = new Map([["T", [
      { date: D, eventId: EO, qty: 2, status: "confirmed", createdAt: 1, source: SRC_STUDIO_CARD },
      { date: D, eventId: EO, qty: 2, status: "confirmed", createdAt: 2, source: SRC_STUDIO_CARD },
    ]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: { [D]: { T: 4 } }, manualReq: {} });
    expect(r.nextById.get("T")).toEqual([{ date: D, eventId: EO, qty: 4, status: "confirmed", createdAt: NOW, source: SRC_STUDIO_CARD }]);
  });
});

describe("planStudioBlocks — freezeCard (empty-build glitch guard)", () => {
  it("keeps every card and adoptable entry untouched when frozen, even with zero card requirement", () => {
    const cardEntry = { date: "2026-11-25", eventId: EO, qty: 8, status: "confirmed", createdAt: 1, source: SRC_STUDIO_CARD };
    const legacyEntry = { date: "2026-11-25", eventId: EO, qty: 2, status: "confirmed", createdAt: 1 };
    const rowsById = new Map([["T", [cardEntry]], ["Z", [legacyEntry]]]);
    const r = planStudioBlocks({ eventId: EO, rowsById, cardReq: {}, manualReq: {}, processedDates: new Set(["2026-11-25"]), liveDates: new Set(["2026-11-25"]), legacyScopeIds: new Set(["T", "Z"]), manualReady: false, freezeCard: true, now: NOW });
    expect(r.changedIds).toEqual([]);
  });
});

describe("planStudioBlocks — manual items (Phase 2 plumbing, inert until manualReady)", () => {
  const base = { eventId: EO, processedDates: new Set([D]), liveDates: new Set([D]), legacyScopeIds: new Set(["T"]), freezeCard: false, now: NOW };

  it("with manualReady=false, an existing studio-manual entry is left exactly as-is and none are added even with a positive manual requirement", () => {
    const entry = { date: D, eventId: EO, qty: 2, status: "confirmed", createdAt: 1, source: SRC_STUDIO_MANUAL };
    const rowsById = new Map([["T", [entry]]]);
    const r = planStudioBlocks({ ...base, rowsById, cardReq: {}, manualReq: { [D]: { T: 99 } }, manualReady: false });
    expect(r.changedIds).toEqual([]);
  });

  it("with manualReady=true, a manual entry is added, updated and released like a card entry, independently of card entries on the same item/date", () => {
    const rowsById = new Map([["T", []]]);
    const added = planStudioBlocks({ ...base, rowsById, cardReq: { [D]: { T: 3 } }, manualReq: { [D]: { T: 5 } }, manualReady: true });
    const next = added.nextById.get("T");
    expect(next).toContainEqual({ date: D, eventId: EO, qty: 3, status: "confirmed", createdAt: NOW, source: SRC_STUDIO_CARD });
    expect(next).toContainEqual({ date: D, eventId: EO, qty: 5, status: "confirmed", createdAt: NOW, source: SRC_STUDIO_MANUAL });

    const rowsById2 = new Map([["T", next]]);
    const released = planStudioBlocks({ ...base, rowsById: rowsById2, cardReq: { [D]: { T: 3 } }, manualReq: {}, manualReady: true, now: NOW + 1 });
    const next2 = released.nextById.get("T");
    expect(next2).toContainEqual({ date: D, eventId: EO, qty: 3, status: "confirmed", createdAt: NOW, source: SRC_STUDIO_CARD });
    expect(next2.some((b) => b.source === SRC_STUDIO_MANUAL)).toBe(false);
  });
});
