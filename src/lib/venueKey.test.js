import { describe, it, expect } from "vitest";
import { venueKey, fnVenueKey } from "./venueKey.js";

describe("venueKey", () => {
  it("trims and lowercases", () => expect(venueKey("  Pushpanjali  ")).toBe("pushpanjali"));
  it("collapses internal whitespace runs to a single space", () => expect(venueKey("Taj   Palace")).toBe("taj palace"));
  it("a stray trailing space and the bare name are the same key", () => expect(venueKey("Pushpanjali ")).toBe(venueKey("Pushpanjali")));
  it("case variants are the same key", () => expect(venueKey("EXOTICA")).toBe(venueKey("exotica")));
  it("null/undefined/empty all key to the empty string", () => {
    expect(venueKey(null)).toBe("");
    expect(venueKey(undefined)).toBe("");
    expect(venueKey("")).toBe("");
  });
});

describe("fnVenueKey", () => {
  const fns = [{ fnVenue: "Pushpanjali" }, { fnVenue: "" }, { fnVenue: "Exotica" }];
  it("uses the function's own venue when it has one", () => {
    expect(fnVenueKey(fns[0], fns)).toBe("pushpanjali");
    expect(fnVenueKey(fns[2], fns)).toBe("exotica");
  });
  it("falls back to fns[0]'s venue when this function's own venue is blank", () => {
    expect(fnVenueKey(fns[1], fns)).toBe("pushpanjali");
  });
  it("still keys to '' if fns[0] ALSO has no venue", () => {
    expect(fnVenueKey({ fnVenue: "" }, [{ fnVenue: "" }])).toBe("");
  });
  it("tolerates a missing/empty fns list", () => {
    expect(fnVenueKey({ fnVenue: "" }, [])).toBe("");
    expect(fnVenueKey({ fnVenue: "" }, undefined)).toBe("");
  });
});
