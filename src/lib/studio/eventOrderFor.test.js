import { describe, it, expect } from "vitest";
import { eventOrderFor } from "./eventOrderFor.js";

describe("eventOrderFor", () => {
  it("takes the live order over cancelled ones, wherever it sits in the list (Test 2)", () => {
    const orders = [
      { id: "eo_mvazcpm", clientId: "CLI_1", status: "cancelled", createdAt: 300 },
      { id: "eo_mvuwzvfr", clientId: "CLI_1", status: "blocked", createdAt: 200 },
      { id: "eo_mvgprthx", clientId: "CLI_1", status: "cancelled", createdAt: 100 },
    ];
    expect(eventOrderFor(orders, "CLI_1", "Test 2").id).toBe("eo_mvuwzvfr");
  });

  it("a pending order counts as live", () => {
    const orders = [{ id: "a", clientId: "C", status: "cancelled", createdAt: 9 }, { id: "b", clientId: "C", status: "pending", createdAt: 1 }];
    expect(eventOrderFor(orders, "C").id).toBe("b");
  });

  it("among live orders, the newest; createdAt missing falls back to the id's time", () => {
    const t = (ms) => "eo_" + ms.toString(36);
    const orders = [{ id: t(1000), clientId: "C", status: "final" }, { id: t(5000), clientId: "C", status: "blocked" }];
    expect(eventOrderFor(orders, "C").id).toBe(t(5000));
  });

  it("only cancelled orders: still the newest of them, as before", () => {
    const orders = [{ id: "a", clientId: "C", status: "cancelled", createdAt: 1 }, { id: "b", clientId: "C", status: "cancelled", createdAt: 2 }];
    expect(eventOrderFor(orders, "C").id).toBe("b");
  });

  it("falls back to the client name, and finds nothing for another client", () => {
    const orders = [{ id: "a", clientName: "Test 2", status: "blocked" }];
    expect(eventOrderFor(orders, "CLI_X", " Test 2 ").id).toBe("a");
    expect(eventOrderFor(orders, "CLI_X", "Other")).toBeUndefined();
    expect(eventOrderFor(null, "C", "x")).toBeUndefined();
  });
});
import { ownEventOrderIds } from "./eventOrderFor.js";
import { netOwnReservedBlocksLive } from "./dealAvailability.js";

describe("a deal booked twice does not read its own stock as taken (Sangeeta 4 Nov)", () => {
  const orders = [
    { id: "eo_a", clientId: "c1", status: "pending" },
    { id: "eo_b", clientId: "c1", status: "blocked" },
    { id: "eo_c", clientId: "c1", status: "cancelled" },
    { id: "eo_x", clientId: "c2", status: "pending" },
  ];
  it("every live order of the client, not cancelled ones or other clients'", () => {
    expect(ownEventOrderIds(orders, "c1").sort()).toEqual(["eo_a", "eo_b"]);
  });
  it("holds under both of the deal's orders are netted out; another event's stay", () => {
    const detail = { sofa: [{ eventId: "eo_a", qty: 2 }, { eventId: "eo_b", qty: 2 }, { eventId: "eo_x", qty: 1 }] };
    expect(netOwnReservedBlocksLive({ sofa: 5 }, "sofa", detail, ownEventOrderIds(orders, "c1")).sofa).toBe(1);
  });
  it("a single id still works as before", () => {
    const detail = { sofa: [{ eventId: "eo_a", qty: 2 }, { eventId: "eo_b", qty: 2 }] };
    expect(netOwnReservedBlocksLive({ sofa: 4 }, "sofa", detail, "eo_a").sofa).toBe(2);
  });
});

describe("ownEventOrderIds never takes a namesake's order", () => {
  it("another client with the same name is left out; an old order with no client id is matched by name", () => {
    const orders = [
      { id: "eo_mine", clientId: "c1", clientName: "Sangeeta", status: "pending" },
      { id: "eo_other", clientId: "c9", clientName: "Sangeeta", status: "pending" },
      { id: "eo_old", clientName: "Sangeeta", status: "pending" },
    ];
    expect(ownEventOrderIds(orders, "c1", "Sangeeta").sort()).toEqual(["eo_mine", "eo_old"]);
    expect(ownEventOrderIds(orders, "c_new", "Sangeeta")).toEqual(["eo_old"]);
  });
});
