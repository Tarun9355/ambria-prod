import { describe, it, expect } from "vitest";
import { isChunkLoadError } from "./chunkReload.js";

describe("stale-build chunk errors", () => {
  it("recognises the messages browsers give when a hashed file is gone", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x.github.io/ambria-prod/assets/IMS-Bg3h-3tZ.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);          // Safari
    expect(isChunkLoadError(new Error("error loading dynamically imported module: …"))).toBe(true); // Firefox
    expect(isChunkLoadError("Loading chunk 12 failed.")).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/IMS-x.css"))).toBe(true);
  });
  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
