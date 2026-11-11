import { describe, it, expect } from "vitest";
import { digits10, planLmsRelinks, planEventOrderLmsSync, RELINK_CIRCUIT_BREAKER } from "./lmsRelink.js";

const contract = (entryNo, contactNo, dates, extra = {}) => ({
  dept: "decor", entryNo, contactNo,
  functions: dates.map((d) => ({ functionDate: d })),
  ...extra,
});
// Same raw shape as a contract row (entryNo/contactNo/functions) — lms_decor_leads rows carry it
// too (the lms-relink Edge Function pages both tables through the same plain jsonb `data` column).
const lead = contract;
const client = (id, patch = {}) => ({
  id, name: "Guest", phone: "9871440883", status: "booked",
  lmsLeadId: "", functions: [{ date: "2026-11-04" }],
  ...patch,
});

describe("digits10", () => {
  it("strips non-digits and the +91 / leading-0 prefixes", () => {
    expect(digits10("+91 98714 40883")).toBe("9871440883");
    expect(digits10("09871440883")).toBe("9871440883");
    expect(digits10("9871440883")).toBe("9871440883");
    expect(digits10("")).toBe("");
  });
});

describe("planLmsRelinks — the Sangeeta case", () => {
  it("relinks a booked client still holding a lead number once a phone+date-matching contract exists", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04", "2026-11-05"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488" })];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(skipped).toEqual([]);
    expect(relinks).toEqual([{ clientId: "CLI_1", from: "01488", to: "00477" }]);
  });

  it("matches on the secondary contact number too", () => {
    const contracts = [contract("00477", "0000000000", ["2026-11-04"], { secondaryContact: "9871440883" })];
    const clients = [client("CLI_1", { lmsLeadId: "01488" })];
    const { relinks } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([{ clientId: "CLI_1", from: "01488", to: "00477" }]);
  });
});

describe("planLmsRelinks — out of scope, never touched", () => {
  it("a client with no lmsLeadId at all", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "" })];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("a venue-linked client", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488", lmsDept: "venue" })];
    const { relinks } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
  });

  it("a client not yet booked", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488", status: "ongoing" })];
    const { relinks } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
  });

  it("an id that is already a contract number — no-op", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "00477" })];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([]);
  });
});

describe("planLmsRelinks — ambiguity guards", () => {
  it("two candidate contracts both matching phone+date — skipped as ambiguous", () => {
    const contracts = [
      contract("00477", "9871440883", ["2026-11-04"]),
      contract("00500", "9871440883", ["2026-11-04"]),
    ];
    const clients = [client("CLI_1", { lmsLeadId: "01488" })];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_1", reason: "ambiguous" }]);
  });

  it("no matching contract at all — skipped, not an error", () => {
    const contracts = [contract("00477", "9999999999", ["2099-01-01"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488" })];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_1", reason: "no-match" }]);
  });

  it("two booked clients both resolving to the same contract — duplicate booking, neither relinked", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [
      client("CLI_1", { lmsLeadId: "01488" }),
      client("CLI_2", { lmsLeadId: "01999" }),
    ];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped.map((s) => s.clientId).sort()).toEqual(["CLI_1", "CLI_2"]);
  });

  it("a contract already claimed by another client's current (correct) link is never handed to a second client", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [
      client("CLI_1", { lmsLeadId: "00477" }),   // already correctly linked
      client("CLI_2", { lmsLeadId: "01488" }),   // a different client, same phone+date, still on the lead number
    ];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_2", reason: "contract-claimed" }]);
  });

  it("trips the circuit breaker instead of writing a pile of corrections at once", () => {
    const contracts = [];
    const clients = [];
    for (let i = 0; i < RELINK_CIRCUIT_BREAKER + 1; i++) {
      contracts.push(contract(`C${i}`, `98714408${String(i).padStart(2, "0")}`, ["2026-11-04"]));
      clients.push(client(`CLI_${i}`, { lmsLeadId: `L${i}`, phone: `98714408${String(i).padStart(2, "0")}` }));
    }
    const { relinks, skipped, tripped, withheld } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(tripped).toBe(true);
    expect(skipped).toEqual([{ reason: "circuit-breaker" }]);
    // Nothing is written, but a caller with no console to watch (the server-side cron runner) can
    // still see exactly what was withheld instead of just knowing something was.
    expect(withheld.relinks.length).toBe(RELINK_CIRCUIT_BREAKER + 1);
  });
});

describe("planLmsRelinks — once relinked, stays put", () => {
  it("re-applies the SAME recorded contract if a stale save reverted lmsLeadId back to the lead number", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488", lmsLeadEntryNo: "01488", lmsContractEntryNo: "00477" })];
    const { reapply, relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([]);
    expect(reapply).toEqual([{ clientId: "CLI_1", from: "01488", to: "00477" }]);
  });

  it("does not re-apply if the previously-recorded contract has since disappeared from the sync", () => {
    const clients = [client("CLI_1", { lmsLeadId: "01488", lmsLeadEntryNo: "01488", lmsContractEntryNo: "00477" })];
    const { reapply, skipped } = planLmsRelinks({ clients, decorContracts: [] });
    expect(reapply).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_1", reason: "reapply-target-missing" }]);
  });

  it("hands off permanently once a human points lmsLeadId at a third, unrelated value", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "99999", lmsLeadEntryNo: "01488", lmsContractEntryNo: "00477" })];
    const { relinks, reapply, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(reapply).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_1", reason: "human-relinked" }]);
  });
});

describe("planLmsRelinks — C2: a correct direct link survives a transient partial sync", () => {
  it("a client verified on a contract id that's missing from today's fetch is a no-op, not a fresh relink", () => {
    // Same guest also has a second real contract (00471, same phone+date) that WOULD look like a
    // one-and-only candidate if the verified id were ever treated as "just a lead number".
    const contracts = [contract("00471", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "00470", lmsContractVerifiedId: "00470" })];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_1", reason: "verified-contract-missing" }]);
  });

  it("a direct link whose contract IS present and phone-matches gets stamped verified", () => {
    const contracts = [contract("00470", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "00470" })];
    const { relinks, reapply, verify } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(reapply).toEqual([]);
    expect(verify).toEqual([{ clientId: "CLI_1", id: "00470" }]);
  });

  it("a direct link whose contract is present but on a DIFFERENT phone is never stamped verified", () => {
    const contracts = [contract("00470", "0000000000", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "00470" })]; // client's own phone is 9871440883
    const { relinks, verify } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(verify).toEqual([]);
  });

  it("canary: several verified ids missing at once trips the breaker instead of guessing", () => {
    const clients = [
      client("CLI_1", { lmsLeadId: "00470", lmsContractVerifiedId: "00470" }),
      client("CLI_2", { lmsLeadId: "00480", lmsContractVerifiedId: "00480" }),
      client("CLI_3", { lmsLeadId: "00490", lmsContractVerifiedId: "00490" }),
      // A fresh lead-stage client that WOULD resolve cleanly, to prove the canary short-circuits
      // before the main loop ever runs, not just coincidentally finds nothing.
      client("CLI_4", { lmsLeadId: "01488", phone: "9999999999", functions: [{ date: "2099-01-01" }] }),
    ];
    const contracts = [contract("00500", "9999999999", ["2099-01-01"])];
    const { relinks, reapply, verify, skipped, tripped, newlyMissingVerifiedIds } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(tripped).toBe(true);
    expect(relinks).toEqual([]);
    expect(reapply).toEqual([]);
    expect(verify).toEqual([]);
    expect(skipped).toEqual([{ reason: "sync-incomplete" }]);
    expect(newlyMissingVerifiedIds.sort()).toEqual(["00470", "00480", "00490"]);
  });

  it("canary: a ghost id already flagged on a prior run doesn't count a second time, so a single genuinely-cancelled contract can't wedge every future run", () => {
    const clients = [
      client("CLI_1", { lmsLeadId: "00470", lmsContractVerifiedId: "00470" }),
      client("CLI_2", { lmsLeadId: "00480", lmsContractVerifiedId: "00480" }),
      client("CLI_3", { lmsLeadId: "00490", lmsContractVerifiedId: "00490" }),
    ];
    // 00470 and 00480 were already seen missing on an earlier run (the caller's persisted set) —
    // only 00490 is a genuinely NEW disappearance this run, below the >=2 floor on its own.
    const { tripped, newlyMissingVerifiedIds } = planLmsRelinks({
      clients, decorContracts: [], knownMissingVerifiedIds: ["00470", "00480"],
    });
    expect(tripped).toBeFalsy();
    // Still reports the FULL current missing set (known or not) for the caller to persist forward.
    expect(newlyMissingVerifiedIds.sort()).toEqual(["00470", "00480", "00490"]);
  });
});

describe("planLmsRelinks — C3: a C2-style wrong relink can't re-entrench itself", () => {
  it("a client already verified on the correct contract never reapplies to its OLD recorded target", () => {
    // CLI_1 was wrongly auto-relinked once (00470 -> 00471) before a human fixed it by hand and the
    // fix got stamped as verified. A stale save reverting lmsLeadId back to 00470 must not make the
    // reapply bookkeeping (still pointing at the old, wrong 00471) win again.
    const contracts = [contract("00471", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", {
      lmsLeadId: "00470", lmsContractVerifiedId: "00470",
      lmsLeadEntryNo: "00470", lmsContractEntryNo: "00471",
    })];
    const { relinks, reapply, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(reapply).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_1", reason: "verified-contract-missing" }]);
  });
});

describe("planLmsRelinks — C4: lead numbers and contract numbers can collide", () => {
  it("with lead evidence available, a collision resolves to the client's OWN contract, not the stranger's", () => {
    const contracts = [
      contract("00342", "9000000002", ["2026-11-04"]),            // the stranger's real contract
      contract("00500", "9871440883", ["2026-11-04"]),             // this client's real, different contract
    ];
    const leads = [lead("00342", "9871440883", ["2026-11-04"])];   // this client's OWN lead, same number as the stranger's contract
    const clients = [
      client("CLI_1", { lmsLeadId: "00342" }),                     // our collision client (phone 9871440883)
      client("CLI_2", { lmsLeadId: "00342", phone: "9000000002" }), // the stranger, correctly on contract 00342
    ];
    const { relinks, skipped, verify } = planLmsRelinks({ clients, decorContracts: contracts, decorLeads: leads });
    expect(relinks).toEqual([{ clientId: "CLI_1", from: "00342", to: "00500" }]);
    // The stranger is a phone-matching direct link on 00342 — a no-op/verify, never blocked.
    expect(skipped.find((s) => s.clientId === "CLI_2")).toBeUndefined();
    expect(verify).toEqual([{ clientId: "CLI_2", id: "00342" }]);
  });

  it("without any lead evidence, a collision is left alone rather than guessed at", () => {
    const contracts = [contract("00342", "9000000002", ["2026-11-04"])]; // stranger's contract only
    const clients = [client("CLI_1", { lmsLeadId: "00342" })]; // our client, phone 9871440883 — doesn't match 00342's phone
    const { relinks, verify, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([]);
    expect(verify).toEqual([]);
    expect(skipped).toEqual([]); // "contract" classification — can't confirm, but not touched either
  });
});

describe("planLmsRelinks — C1 Gap B: a non-decor client can't lock a decor contract away", () => {
  it("a venue client sharing a decor contract's entry number never blocks that contract's real decor client", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [
      client("CLI_VENUE", { lmsLeadId: "00477", lmsDept: "venue" }),
      client("CLI_DECOR", { lmsLeadId: "01488" }),
    ];
    const { relinks, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(relinks).toEqual([{ clientId: "CLI_DECOR", from: "01488", to: "00477" }]);
    expect(skipped.find((s) => s.clientId === "CLI_DECOR")).toBeUndefined();
  });
});

describe("planLmsRelinks — C1 Gap A / C5: a client awaiting reapply blocks a fresh relink to the same target", () => {
  it("the reapply wins; a fresh client independently matching the same contract is skipped, not double-booked", () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [
      client("CLI_1", { lmsLeadId: "01488", lmsLeadEntryNo: "01488", lmsContractEntryNo: "00477" }),
      client("CLI_2", { lmsLeadId: "01999" }),
    ];
    const { relinks, reapply, skipped } = planLmsRelinks({ clients, decorContracts: contracts });
    expect(reapply).toEqual([{ clientId: "CLI_1", from: "01488", to: "00477" }]);
    expect(relinks).toEqual([]);
    expect(skipped).toEqual([{ clientId: "CLI_2", reason: "contract-claimed" }]);
  });
});

describe("planEventOrderLmsSync — C6: event_orders drift is re-derived every run, not tried once", () => {
  const eo = (id, clientId, lmsLeadId, extra = {}) => ({ id, clientId, lmsLeadId, status: "sold", ...extra });
  const relinkedClient = (id, patch = {}) => client(id, {
    lmsLeadId: "00477", lmsLeadEntryNo: "01488", lmsContractEntryNo: "00477", ...patch,
  });

  it("an order still on null gets a patch expecting null", () => {
    const clients = [relinkedClient("CLI_1")];
    const eventOrders = [eo("eo1", "CLI_1", null)];
    const { patches } = planEventOrderLmsSync({ clients, eventOrders });
    expect(patches).toEqual([{ eoId: "eo1", clientId: "CLI_1", expect: null, to: "00477", from: "01488" }]);
  });

  it("an order still on the OLD lead number gets a patch expecting that number", () => {
    const clients = [relinkedClient("CLI_1")];
    const eventOrders = [eo("eo1", "CLI_1", "01488")];
    const { patches } = planEventOrderLmsSync({ clients, eventOrders });
    expect(patches).toEqual([{ eoId: "eo1", clientId: "CLI_1", expect: "01488", to: "00477", from: "01488" }]);
  });

  it("an order already on the corrected contract number needs no patch", () => {
    const clients = [relinkedClient("CLI_1")];
    const eventOrders = [eo("eo1", "CLI_1", "00477")];
    const { patches, skipped } = planEventOrderLmsSync({ clients, eventOrders });
    expect(patches).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("an order on some OTHER unexplained id is left alone, not overwritten", () => {
    const clients = [relinkedClient("CLI_1")];
    const eventOrders = [eo("eo1", "CLI_1", "99999")];
    const { patches, skipped } = planEventOrderLmsSync({ clients, eventOrders });
    expect(patches).toEqual([]);
    expect(skipped).toEqual([{ eoId: "eo1", reason: "eo-unknown-id:99999" }]);
  });

  it("a cancelled order is ignored entirely", () => {
    const clients = [relinkedClient("CLI_1")];
    const eventOrders = [eo("eo1", "CLI_1", null, { status: "cancelled" })];
    const { patches } = planEventOrderLmsSync({ clients, eventOrders });
    expect(patches).toEqual([]);
  });

  it("a client not (yet) auto-relinked to its current target produces nothing", () => {
    const clients = [client("CLI_1", { lmsLeadId: "01488" })]; // no lmsContractEntryNo at all
    const eventOrders = [eo("eo1", "CLI_1", null)];
    const { patches } = planEventOrderLmsSync({ clients, eventOrders });
    expect(patches).toEqual([]);
  });
});
