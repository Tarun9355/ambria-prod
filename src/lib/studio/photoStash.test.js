import { describe, it, expect } from "vitest";
import {
  PHOTO_STASH_LIMIT, photoStashKey, zoneCfgSig, zoneSwitchState, capPhotoStash, planPhotoSwitch, zoneAfterSwitch, stripPhotoStash,
} from "./photoStash.js";

// A zone as Build holds it, driven the way selectElPhoto drives it. "fresh" loads the photo's own elements / config
// (what the library photo carries), the rest goes through zoneAfterSwitch - the same calls StudioApp makes.
const A = { src: "https://img/a.jpg", eventId: "LIBA", elements: [{ name: "Rose wall", qty: 2 }], cfg: { trT: "Box", dims: { w: 10 } } };
const B = { src: "https://img/b.jpg", eventId: "LIBB", elements: [{ name: "Urli", qty: 4 }], cfg: { trT: "Arch", dims: { w: 12 } } };
const C = { src: "https://img/c.jpg", eventId: "LIBC", elements: [], cfg: null };

function makeZone() { return { elements: [], config: undefined, note: "", sel: undefined }; }

// one photo click; answer = what the user clicks if asked (null = Cancel). Returns { asked, done }.
function pick(z, photo, answer = "switch", opts = {}) {
  const st = zoneSwitchState({ currentSel: z.sel, elements: z.elements, zoneCfg: z.config, note: z.note });
  if (z.sel && z.sel.src === photo.src) throw new Error("same-photo clear is not a switch");
  let choice = "switch", asked = false;
  if (st.hasUnsavedWork && !opts.skipConfirm) {
    asked = true;
    choice = answer;
    if (!choice) return { asked, done: false };
  }
  const plan = planPhotoSwitch({ state: st, currentSel: z.sel, photo, choice, now: (z.clock = (z.clock || 1000) + 10) });
  const after = zoneAfterSwitch({ plan, state: st, photo, liveCfg: z.config });
  if (after) { Object.assign(z, after); return { asked, done: true, mode: plan.mode }; }
  // fresh - as selectElPhoto: the photo's elements and config, the zone's live scale / repeat, the stash
  const stashPatch = Object.keys(plan.stash).length ? { photoStash: plan.stash } : {};
  const els = JSON.parse(JSON.stringify(photo.elements || []));
  if (photo.cfg) z.config = { ...photo.cfg, scale: z.config?.scale, repeat: z.config?.repeat, repeatCats: z.config?.repeatCats, ...stashPatch };
  else if (stashPatch.photoStash) z.config = { ...(z.config || {}), ...stashPatch };
  z.elements = els;
  z.note = "";
  z.sel = { ...photo, _loadedElements: els, _loadedCfg: zoneCfgSig(photo.cfg || st.curCfg), _loadedNote: "" };
  return { asked, done: true, mode: plan.mode };
}
// what a save + reopen keeps of the selected photo (StudioApp strips the record to these four)
const reopen = (z) => { z.sel = z.sel && { src: z.sel.src, eventName: z.sel.eventName, isLibrary: z.sel.isLibrary, eventId: z.sel.eventId }; z.config = JSON.parse(JSON.stringify(z.config ?? null)) ?? undefined; };
const names = (z) => z.elements.map((e) => e.name);

describe("photo switch - just browsing", () => {
  it("does not ask and saves nothing when nothing was changed", () => {
    const z = makeZone();
    expect(pick(z, A).asked).toBe(false);
    expect(pick(z, B).asked).toBe(false);
    expect(names(z)).toEqual(["Urli"]);
    expect(z.config.photoStash).toBeUndefined();
  });
  it("first pick into an empty zone does not ask", () => {
    const z = makeZone();
    expect(pick(z, A)).toMatchObject({ asked: false, mode: "fresh" });
    expect(z.config.trT).toBe("Box");
  });
});

describe("Save & Switch", () => {
  it("keeps A's edits with A, opens B fresh, and brings A's edits back on returning", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [...z.elements, { name: "Added chair", qty: 6 }];
    z.config = { ...z.config, trT: "Pipe", prints: [{ type: "Flex", qty: 2 }] };
    z.note = "No couch";
    expect(pick(z, B, "switch")).toMatchObject({ asked: true, mode: "fresh" });
    expect(names(z)).toEqual(["Urli"]);
    expect(z.config.trT).toBe("Arch");
    expect(z.config.prints).toBeUndefined();
    expect(z.note).toBe("");
    // B untouched -> no question going back; A comes back exactly as left
    expect(pick(z, A)).toMatchObject({ asked: false, mode: "saved" });
    expect(names(z)).toEqual(["Rose wall", "Added chair"]);
    expect(z.config.trT).toBe("Pipe");
    expect(z.config.prints).toEqual([{ type: "Flex", qty: 2 }]);
    expect(z.note).toBe("No couch");
  });
  it("keeps independent builds for both photos", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "A only", qty: 1 }];
    pick(z, B, "switch");
    z.elements = [{ name: "B only", qty: 1 }];
    z.note = "B note";
    expect(pick(z, A, "switch")).toMatchObject({ asked: true, mode: "saved" });
    expect(names(z)).toEqual(["A only"]);
    expect(z.note).toBe("");
    pick(z, B);
    expect(names(z)).toEqual(["B only"]);
    expect(z.note).toBe("B note");
  });
  it("saves a truss / platform / print change made alone without asking", () => {
    const z = makeZone();
    pick(z, A);
    z.config = { ...z.config, plH: 2, extraTrussRows: [{ trT: "Box", trussQty: 2 }] };
    expect(pick(z, B).asked).toBe(false);
    pick(z, A);
    expect(z.config.plH).toBe(2);
    expect(z.config.extraTrussRows).toEqual([{ trT: "Box", trussQty: 2 }]);
  });
  it("re-saves a returned-to photo when it is changed again", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "v1", qty: 1 }];
    pick(z, B, "switch");
    pick(z, A);
    z.elements = [{ name: "v2", qty: 1 }];
    pick(z, B, "switch");
    pick(z, A);
    expect(names(z)).toEqual(["v2"]);
  });
});

describe("Save & Replace", () => {
  it("puts the zone exactly as it is on the new photo, and saves it with both photos", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [...z.elements, { name: "Added chair", qty: 6 }];
    z.config = { ...z.config, trT: "Pipe", scale: 3 };
    z.note = "No couch";
    expect(pick(z, B, "replace")).toMatchObject({ asked: true, mode: "replace" });
    expect(z.sel.src).toBe(B.src);
    expect(names(z)).toEqual(["Rose wall", "Added chair"]);
    expect(z.config.trT).toBe("Pipe");
    expect(z.config.scale).toBe(3);
    expect(z.note).toBe("No couch");
    expect(Object.keys(z.config.photoStash).sort()).toEqual([A.src, B.src].sort());
  });
  it("does not ask again right after, and does not duplicate elements", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "Mine", qty: 1 }];
    pick(z, B, "replace");
    expect(z.elements).toHaveLength(1);
    expect(pick(z, C).asked).toBe(false); // nothing changed since the replace
    pick(z, B);
    expect(names(z)).toEqual(["Mine"]);
    pick(z, A);
    expect(names(z)).toEqual(["Mine"]);
  });
  it("the stash never nests inside a saved config", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "x", qty: 1 }];
    pick(z, B, "replace");
    z.elements = [{ name: "y", qty: 1 }];
    pick(z, C, "replace");
    Object.values(z.config.photoStash).forEach((w) => expect(w.config.photoStash).toBeUndefined());
  });
});

describe("Cancel", () => {
  it("changes nothing", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "Mine", qty: 1 }];
    const before = JSON.stringify(z);
    expect(pick(z, B, null)).toEqual({ asked: true, done: false });
    expect(JSON.stringify(z)).toBe(before);
  });
});

describe("after a save and reopen", () => {
  it("still asks (the stamps are gone), and Save & Switch still returns the build", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "Mine", qty: 1 }];
    z.note = "kept";
    reopen(z);
    expect(pick(z, B, "switch").asked).toBe(true);
    reopen(z);
    pick(z, A, "switch"); // B is unstamped after reopen too, so it is asked about and saved
    expect(names(z)).toEqual(["Mine"]);
    expect(z.note).toBe("kept");
  });
  it("the stash survives the deal's JSON save", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "Mine", qty: 1 }];
    pick(z, B, "switch");
    reopen(z);
    expect(z.config.photoStash[A.src].elements).toEqual([{ name: "Mine", qty: 1 }]);
  });
});

describe("a zone with no photo yet", () => {
  it("asks when elements were added by hand, and 'keep' carries them onto the photo", () => {
    const z = makeZone();
    z.elements = [{ name: "Hand-made", qty: 1 }];
    z.note = "draft";
    const st = zoneSwitchState({ currentSel: z.sel, elements: z.elements, zoneCfg: z.config, note: z.note });
    expect(st).toMatchObject({ hasUnsavedWork: true, hasPhoto: false });
    pick(z, A, "replace");
    expect(names(z)).toEqual(["Hand-made"]);
    expect(z.note).toBe("draft");
    expect(z.sel.src).toBe(A.src);
  });
  it("asks about a note typed before any photo, instead of dropping it", () => {
    const z = makeZone();
    z.note = "typed first";
    expect(pick(z, A, null)).toEqual({ asked: true, done: false });
    expect(z.note).toBe("typed first");
  });
  it("'use the photo's own' loads the photo", () => {
    const z = makeZone();
    z.elements = [{ name: "Hand-made", qty: 1 }];
    expect(pick(z, A, "fresh").mode).toBe("fresh");
    expect(names(z)).toEqual(["Rose wall"]);
  });
});

describe("zones", () => {
  it("a photo's build in one zone is not offered in another", () => {
    const hall = makeZone(), stage = makeZone();
    pick(hall, A);
    hall.elements = [{ name: "Hall build", qty: 1 }];
    pick(hall, B, "switch");
    pick(stage, A);
    expect(names(stage)).toEqual(["Rose wall"]);
  });
  it("live repeat stays the deal's choice when a saved build opens", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "Mine", qty: 1 }];
    pick(z, B, "switch");
    z.config = { ...z.config, repeat: true, repeatCats: { elements: true } };
    pick(z, A);
    expect(z.config.repeat).toBe(true);
    expect(z.config.repeatCats).toEqual({ elements: true });
  });
  it("a saved build opens with its own scale (its quantities were scaled by it)", () => {
    const z = makeZone();
    pick(z, A);
    z.config = { ...z.config, scale: 4 };
    z.elements = [{ name: "Rose wall", qty: 8, baseQty: 2 }];
    pick(z, B, "switch");
    pick(z, A);
    expect(z.config.scale).toBe(4);
    expect(z.elements[0].qty).toBe(8);
  });
});

describe("helpers", () => {
  it("photoStashKey uses src, else eventId", () => {
    expect(photoStashKey({ src: "s", eventId: "e" })).toBe("s");
    expect(photoStashKey({ eventId: "e" })).toBe("e");
    expect(photoStashKey(null)).toBe("");
  });
  it("zoneCfgSig ignores scale, repeat and the stash", () => {
    expect(zoneCfgSig({ trT: "Box", scale: 3, repeat: true, repeatCats: {}, photoStash: { a: 1 } })).toBe(zoneCfgSig({ trT: "Box" }));
    expect(zoneCfgSig({ trT: "Box" })).not.toBe(zoneCfgSig({ trT: "Arch" }));
  });
  it(`keeps only the newest ${PHOTO_STASH_LIMIT} photos per zone`, () => {
    const stash = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, { savedAt: i }]));
    const kept = capPhotoStash(stash);
    expect(Object.keys(kept)).toHaveLength(PHOTO_STASH_LIMIT);
    expect(kept.p19).toBeTruthy();
    expect(kept.p0).toBeUndefined();
  });
  it("cap holds through many switches", () => {
    const z = makeZone();
    for (let i = 0; i < 30; i++) {
      const ph = { src: `https://img/${i}.jpg`, elements: [{ name: `e${i}`, qty: 1 }], cfg: { trT: "Box" } };
      pick(z, ph);
      z.elements = [{ name: `edited ${i}`, qty: 1 }];
    }
    expect(Object.keys(z.config.photoStash).length).toBeLessThanOrEqual(PHOTO_STASH_LIMIT);
  });
  it("stripPhotoStash removes the stash and drops zones holding only it", () => {
    const out = stripPhotoStash({
      Stage: { trT: "Box", photoStash: { a: {} } },
      Entry: { photoStash: { a: {} } },
      Bar: { plH: 2 },
      Odd: null,
    });
    expect(out).toEqual({ Stage: { trT: "Box" }, Bar: { plH: 2 }, Odd: null });
    expect(stripPhotoStash(undefined)).toEqual({});
  });
  it("skipConfirm (zone upload's Apply) saves the current build before loading", () => {
    const z = makeZone();
    pick(z, A);
    z.elements = [{ name: "Mine", qty: 1 }];
    expect(pick(z, B, "switch", { skipConfirm: true }).asked).toBe(false);
    pick(z, A);
    expect(names(z)).toEqual(["Mine"]);
  });
});
