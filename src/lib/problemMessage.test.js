import { describe, it, expect } from "vitest";
import { problemKind, mainKind, problemSummary, problemDetail } from "./problemMessage.js";

describe("problemKind", () => {
  it.each([
    ["Failed to load (TypeError: Failed to fetch) — x", "offline"],
    ["NetworkError when attempting to fetch resource.", "offline"],
    ["Load failed", "offline"],
    ["Failed to load (JWT expired) — x", "login"],
    ["new row violates row-level security policy", "login"],
    ["HTTP 401", "login"],
    ["HTTP 503", "server"],
    ["Too many requests", "server"],
    ["duplicate key value violates unique constraint", "other"],
    ["", "other"],
  ])("%s -> %s", (msg, kind) => expect(problemKind(msg)).toBe(kind));
  it("offline wins whenever the browser says it is offline", () => {
    expect(problemKind("HTTP 503", false)).toBe("offline");
  });
});

describe("problemSummary", () => {
  it("leads with the most likely cause across all problems", () => {
    const ps = [{ error: "Failed to load (HTTP 503) — a" }, { error: "Failed to load (JWT expired) — b" }, { error: "Failed to load (Failed to fetch) — c" }];
    expect(mainKind(ps)).toBe("offline");
    expect(problemSummary(ps).title).toMatch(/internet/i);
    expect(problemSummary([{ error: "Failed to load (JWT expired) — b" }])).toMatchObject({ kind: "login", action: "login" });
  });
  it("save wording keeps the change and offers Retry", () => {
    expect(problemSummary([{ error: "Save failed: Failed to fetch" }], "save")).toMatchObject({ kind: "offline", action: "retry" });
    expect(problemSummary([{ error: "weird" }], "save").title).toBe("A change couldn't be saved");
  });
  it("never shows backend text in the title", () => {
    const s = problemSummary([{ error: "Failed to load (PGRST301 JWT expired) — admin config" }]);
    expect(s.title).not.toMatch(/JWT|PGRST|admin config/);
  });
});

describe("problemDetail", () => {
  it("drops the 'Failed to load (reason) —' prefix", () => {
    expect(problemDetail("Failed to load (JWT expired) — the item list may be incomplete")).toBe("The item list may be incomplete");
    expect(problemDetail("Failed to load — admin config is read-only")).toBe("Admin config is read-only");
    expect(problemDetail("Save failed: boom")).toBe("Boom");
    expect(problemDetail("")).toBe("");
  });
});
