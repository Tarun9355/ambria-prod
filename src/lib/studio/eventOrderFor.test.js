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
