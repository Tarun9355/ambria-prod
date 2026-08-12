import { describe, it, expect } from "vitest";
import { isInventoryPhoto, deckImageUrl } from "./thumb";

const BASE = "https://taalribntdkowoqltvqw.supabase.co/storage/v1/object/public/media";

// The client asked for no inventory pictures in the design presentation. That is a rule about a
// document a client reads, so it is worth holding here rather than trusting that nobody re-wires
// inventory into the deck later.
describe("isInventoryPhoto", () => {
  it("catches warehouse product shots", () => {
    expect(isInventoryPhoto(`${BASE}/inventory/sofa/abc123.jpg`)).toBe(true);
  });

  it("leaves every reference bucket alone", () => {
    expect(isInventoryPhoto(`${BASE}/ambria-ref/stage/haldi/x.jpg`)).toBe(false);
    expect(isInventoryPhoto(`${BASE}/inhouse-venues/cocktail/lounge/x.jpg`)).toBe(false);
    expect(isInventoryPhoto(`${BASE}/outside-venues/stage/wedding/x.jpg`)).toBe(false);
  });

  it("still matches once the URL has been through deckImageUrl", () => {
    // The deck crops before placing, so the guard has to survive the rewrite to /render/image/.
    expect(isInventoryPhoto(deckImageUrl(`${BASE}/inventory/chair/x.jpg`, 800, 600))).toBe(true);
  });

  it("does not fall over on empty or non-string input", () => {
    expect(isInventoryPhoto("")).toBe(false);
    expect(isInventoryPhoto(null)).toBe(false);
    expect(isInventoryPhoto(undefined)).toBe(false);
  });

  it("does not match a reference photo that merely mentions inventory in a filename", () => {
    expect(isInventoryPhoto(`${BASE}/ambria-ref/stage/inventory-shoot.jpg`)).toBe(false);
  });
});

describe("deckImageUrl", () => {
  it("crops to the requested box on Supabase Storage URLs", () => {
    const out = deckImageUrl(`${BASE}/ambria-ref/a.jpg`, 1200, 900);
    expect(out).toContain("/render/image/public/");
    expect(out).toContain("width=1200");
    expect(out).toContain("height=900");
    expect(out).toContain("resize=cover");
  });

  it("leaves anything that is not Supabase Storage untouched", () => {
    const ext = "https://res.cloudinary.com/dy9wfqhry/image/upload/x.jpg";
    expect(deckImageUrl(ext, 800, 600)).toBe(ext);
  });

  it("does not crop twice — an already-rendered URL passes through", () => {
    // Cropping a cropped URL is what produced the zoomed-in photographs in the deck.
    const once = deckImageUrl(`${BASE}/ambria-ref/a.jpg`, 1200, 900);
    expect(deckImageUrl(once, 400, 300)).toBe(once);
  });
});
