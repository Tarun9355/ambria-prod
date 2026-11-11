import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { runLmsRelinkPass } from "./lmsRelinkRun.js";
import { RELINK_CIRCUIT_BREAKER } from "./lmsRelink.js";

const contract = (entryNo, contactNo, dates, extra = {}) => ({
  dept: "decor", entryNo, contactNo,
  functions: dates.map((d) => ({ functionDate: d })),
  ...extra,
});
const client = (id, patch = {}) => ({
  id, name: "Guest", phone: "9871440883", status: "booked",
  lmsLeadId: "", functions: [{ date: "2026-11-04" }],
  ...patch,
});

// Fake patch functions that just record calls and apply compare-and-set in memory, exactly like
// the real patch_client_ledger_lms/patch_event_order_lms RPCs (but no Supabase round-trip). Stores
// its OWN copies, not the caller's original objects — otherwise a successful patch would mutate the
// caller's `clients`/`eventOrders` array in place (via Object.assign below) and a test could pass
// for the wrong reason: planEventOrderLmsSync seeing the relink through that shared-reference
// mutation instead of through runLmsRelinkPass's own `cur` working copy, which is the thing the
// "same pass" test below is actually meant to prove.
function fakeStore(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  const calls = [];
  const patch = async (id, expect, p) => {
    calls.push({ id, expect, patch: p });
    const row = byId.get(id);
    if (!row) return false;
    const curId = row.lmsLeadId == null ? null : String(row.lmsLeadId);
    const expectStr = expect == null ? null : String(expect);
    if (curId !== expectStr) return false;
    Object.assign(row, p);
    return true;
  };
  return { patch, calls, byId };
}

describe("runLmsRelinkPass", () => {
  it("a clean relink calls patchClient with expect=from and the full patch, including lastSavedAt", async () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488" })];
    const clientStore = fakeStore(clients);
    const eoStore = fakeStore([]);
    const now = () => 1700000000000;

    const result = await runLmsRelinkPass({
      clients, eventOrders: [], decorContracts: contracts, decorLeads: [],
      patchClient: clientStore.patch, patchEventOrder: eoStore.patch, now,
    });

    expect(result.relinked).toEqual([{ clientId: "CLI_1", from: "01488", to: "00477" }]);
    expect(clientStore.calls).toEqual([{
      id: "CLI_1", expect: "01488",
      patch: {
        lmsLeadId: "00477", lmsDept: "decor",
        lmsLeadEntryNo: "01488", lmsContractEntryNo: "00477", lmsContractVerifiedId: "00477",
        lmsRelinkedAt: now(), lmsRelinkedBy: "auto", lmsRelinkMatch: "phone+date",
        lastSavedAt: now(),
      },
    }]);
  });

  it("a relink in this pass also produces an event_orders patch in the SAME pass (not one run later)", async () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488" })];
    const eventOrders = [{ id: "eo1", clientId: "CLI_1", clientName: "Guest", lmsLeadId: "01488", status: "sold" }];
    const clientStore = fakeStore(clients);
    const eoStore = fakeStore(eventOrders);

    const result = await runLmsRelinkPass({
      clients, eventOrders, decorContracts: contracts, decorLeads: [],
      patchClient: clientStore.patch, patchEventOrder: eoStore.patch,
    });

    expect(result.relinked).toEqual([{ clientId: "CLI_1", from: "01488", to: "00477" }]);
    expect(result.eoPatched).toEqual([{ eoId: "eo1", clientId: "CLI_1", from: "01488", to: "00477" }]);
    expect(eoStore.byId.get("eo1").lmsLeadId).toBe("00477");
  });

  it("canary trip: no patchClient calls, but event_orders sync still runs for an already-settled client", async () => {
    const clients = [
      client("CLI_1", { lmsLeadId: "00470", lmsContractVerifiedId: "00470" }),
      client("CLI_2", { lmsLeadId: "00480", lmsContractVerifiedId: "00480" }),
      client("CLI_3", {
        lmsLeadId: "00477", lmsLeadEntryNo: "01488", lmsContractEntryNo: "00477", lmsContractVerifiedId: "00477",
      }),
    ];
    const eventOrders = [{ id: "eo1", clientId: "CLI_3", clientName: "Guest", lmsLeadId: "01488", status: "sold" }];
    const clientStore = fakeStore(clients);
    const eoStore = fakeStore(eventOrders);

    const result = await runLmsRelinkPass({
      clients, eventOrders, decorContracts: [], decorLeads: [],
      patchClient: clientStore.patch, patchEventOrder: eoStore.patch,
    });

    expect(result.tripped).toBe(true);
    expect(clientStore.calls).toEqual([]);
    expect(result.eoPatched).toEqual([{ eoId: "eo1", clientId: "CLI_3", from: "01488", to: "00477" }]);
  });

  it("patchClient returns false (lost the race): not counted as relinked, no event_orders patch that client this pass", async () => {
    const contracts = [contract("00477", "9871440883", ["2026-11-04"])];
    const clients = [client("CLI_1", { lmsLeadId: "01488" })];
    const eventOrders = [{ id: "eo1", clientId: "CLI_1", clientName: "Guest", lmsLeadId: "01488", status: "sold" }];
    const eoStore = fakeStore(eventOrders);
    const patchClient = async () => false; // simulates another run already having moved this row

    const result = await runLmsRelinkPass({
      clients, eventOrders, decorContracts: contracts, decorLeads: [],
      patchClient, patchEventOrder: eoStore.patch,
    });

    expect(result.relinked).toEqual([]);
    expect(result.casMissed).toEqual([{ clientId: "CLI_1", from: "01488", to: "00477" }]);
    expect(result.eoPatched).toEqual([]);
  });

  it("patchClient throws for one client: recorded in errors, the next client is still processed", async () => {
    const contracts = [
      contract("00477", "9871440883", ["2026-11-04"]),
      contract("00478", "9871440884", ["2026-11-05"]),
    ];
    const clients = [
      client("CLI_1", { lmsLeadId: "01488" }),
      client("CLI_2", { lmsLeadId: "01489", phone: "9871440884", functions: [{ date: "2026-11-05" }] }),
    ];
    const eoStore = fakeStore([]);
    const patchClient = vi.fn(async (id) => {
      if (id === "CLI_1") throw new Error("network blip");
      return true;
    });

    const result = await runLmsRelinkPass({
      clients, eventOrders: [], decorContracts: contracts, decorLeads: [],
      patchClient, patchEventOrder: eoStore.patch,
    });

    expect(result.errors).toEqual([{ stage: "client", clientId: "CLI_1", message: "network blip" }]);
    expect(result.relinked).toEqual([{ clientId: "CLI_2", from: "01489", to: "00478" }]);
  });

  it("verify is capped at verifyCap", async () => {
    const clients = [];
    const contracts = [];
    for (let i = 0; i < 3; i++) {
      const phone = `987144000${i}`;
      contracts.push(contract(`C${i}`, phone, ["2026-11-04"]));
      clients.push(client(`CLI_${i}`, { lmsLeadId: `C${i}`, phone, functions: [{ date: "2026-11-04" }] }));
    }
    const clientStore = fakeStore(clients);
    const eoStore = fakeStore([]);

    const result = await runLmsRelinkPass({
      clients, eventOrders: [], decorContracts: contracts, decorLeads: [],
      patchClient: clientStore.patch, patchEventOrder: eoStore.patch, verifyCap: 2,
    });

    expect(result.verified.length).toBe(2);
  });

  // Guard: the edge function bundles these modules directly from src/ via Deno — any import that
  // isn't a plain relative "./x.js" (a bare specifier, a non-.js extension, or reaching outside this
  // directory) would either fail to bundle or silently pull in something Deno/browser-incompatible.
  it("guard: lmsRelink/eventOrderFor/lmsRelinkRun/clientRow only use relative ./x.js imports", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const files = ["lmsRelink.js", "eventOrderFor.js", "lmsRelinkRun.js", "clientRow.js"];
    const importRe = /^\s*import\s+.*?\s+from\s+["']([^"']+)["']/gm;
    for (const f of files) {
      const src = readFileSync(here + f, "utf8");
      const specs = [...src.matchAll(importRe)].map((m) => m[1]);
      for (const spec of specs) {
        expect(spec, `${f} imports "${spec}"`).toMatch(/^\.\/[\w-]+\.js$/);
      }
    }
  });
});
