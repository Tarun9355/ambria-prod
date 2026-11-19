import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// Commit 6df7461c: a Floral kit's parts card prints in the combined "All departments" book, and an EDITED kit
// (element.kitOverrides) prints exactly the parts Build has now at per-kit qty x this zone's kit qty.
// Fixture modelled on the owner's real case: a "Cabinets Console" (Florals, qty 4, zone Installations).

const PARTS = [
  { id: "p1", name: "Golden Brass leaf Pot", category: "Florals" },
  { id: "p2", name: "Round Fibre Pot Medium", category: "Florals", subCat: "Fibre Pots" },
  { id: "p3", name: "Golden Brass Surahi Pot", category: "Florals" },
  { id: "p4", name: "Pillar Candle", category: "Florals", unit: "pc" },
  { id: "p5", name: "CHIMNEY CANDLE STAND", category: "Florals" },
  { id: "p6", name: "China Shamadhan 3 size", category: "Furniture" },
  { id: "p7", name: "Books", category: "Florals" },
  { id: "p8", name: "Wooden Chester Box", category: "Furniture" },
  { id: "p9", name: "Brass <Diya> & \"Co\"", category: "Florals" },
];
const KIT = { id: "kit1", name: "Cabinets Console", category: "Florals", subItems: PARTS.slice(0, 8).map(p => ({ itemId: p.id, qty: 1 })) };
const KIT2 = { id: "kit2", name: "Tent Tree", category: "Tenting", subItems: [{ itemId: "t1", qty: 2 }, { itemId: "p4", qty: 1 }] };
const TENT_PART = { id: "t1", name: "Tree Branch Bar", category: "Tenting" };
const inventory = [...PARTS, KIT, KIT2, TENT_PART];
const catToDept = (c) => ({ Florals: "Floral", Tenting: "Tenting", Fabric: "Fabric", Furniture: "Structure" })[c] || "";
const empty = () => ({ rows: [] });
const patterns = [
  { id: "fp1", name: "Fibre Pot Recipe", sub: "Fibre Pots", mode: "smb", unit: "pc", sizes: { small: { flowers: [] }, medium: { flowers: [] }, big: { flowers: [] } } },
  { id: "fp2", name: "Chandelier Recipe", sub: "Chand", mode: "flat", unit: "pc", sizes: { medium: { flowers: [] } } },
];

const baseSel = (zones, extra = {}) => ({
  id: "e1", clientName: "Test", date: "2026-12-01",
  functionsDetail: [{ fnType: "Wedding", date: "2026-12-01", venue: "", zones: Object.keys(zones), elements: zones }],
  ...extra,
});
const mkCtx = (dept, sel, over = {}) => ({
  dept, sel, inventory, blocks: {}, settings: {}, trussInv: {}, catToDept, authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: new Map(), fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: empty, elementPlanOf: empty,
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [], ...over,
});
const combinedBook = (sel, over, opts) => buildDeptBookHtml(mkCtx("Floral", sel, over), {}, {}, { combined: true, ...opts });
const singleBook = (dept, sel, over, opts) => buildDeptBookHtml(mkCtx(dept, sel, over), {}, {}, opts || {});

const strip = (s) => s.replace(/<em[^>]*>[^<]*<\/em>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
// every .kb card: { icon, name, qty, parts: [{ name, qty, unit, tags }] }
const cards = (html) => html.split('<div class="kb">').slice(1).map(chunk => {
  const nm = /<div class="kb-nm">([^<]*)<\/div>/.exec(chunk)?.[1] || "";
  const qtyM = /<div class="kb-zk">Qty<\/div><div class="kb-zv">([^<]*)<\/div>/.exec(chunk);
  const ul = /<ul class="kb-l[^"]*">([\s\S]*?)<\/ul>/.exec(chunk)?.[1] || "";
  const parts = [...ul.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => {
    const sp = /<span>([\s\S]*?)<\/span>/.exec(m[1])?.[1] || "";
    const b = /<b>([\s\S]*?)<\/b>/.exec(m[1])?.[1] || "";
    const tags = [...sp.matchAll(/<em class="kb-tg">([^<]*)<\/em>/g)].map(x => x[1]);
    return { name: strip(sp), qty: strip(b), tags };
  });
  return { icon: nm.split(" ")[0], name: strip(nm.replace(/^\S+\s/, "")), qty: qtyM ? strip(qtyM[1]) : "", parts };
});
const kitCard = (html, name) => cards(html).find(c => c.icon === "📦" && c.name === name);
const partQty = (card, name) => { const q = card?.parts.find(p => p.name === name)?.qty; return q === undefined ? undefined : String(parseFloat(q)); };
const partQtyRaw = (card, name) => card?.parts.find(p => p.name === name)?.qty;
const kitBadge = (html, n) => html.includes(`KIT · ${n}`);

// the owner's real edit: re-counts per kit, some with a real %
const OVERRIDES = [
  { itemId: "p1", qty: 1 }, { itemId: "p2", qty: 1, realPct: 70, size: "M" }, { itemId: "p3", qty: 1 },
  { itemId: "p4", qty: 3 }, { itemId: "p5", qty: 0.5 }, { itemId: "p6", qty: 1.75 }, { itemId: "p7", qty: 1 }, { itemId: "p8", qty: 1 },
];
// Deal Check's snapshot of the (older, un-edited) kit held by Floral
const snapKit = (qty = 4, parts = PARTS.slice(0, 8)) => ({ name: "Cabinets Console", imsId: "kit1", qty, isKit: true, components: parts.map(p => ({ name: p.name, qty: qty, imsId: p.id })) });
const selWith = (el, extra = {}) => baseSel({ installations: [el] }, extra);
const consoleEl = (over = {}) => ({ name: "Cabinets Console", invId: "kit1", qty: 4, ...over });

describe("floral kit in the combined book: the owner's Cabinets Console", () => {
  it("never edited, no snapshot: prints the master list at kit qty (parts x 4)", () => {
    const html = combinedBook(selWith(consoleEl()));
    const c = kitCard(html, "Cabinets Console");
    expect(c).toBeTruthy();
    expect(c.qty).toBe("4");
    expect(c.parts).toHaveLength(8);
    // master list: 1 per kit in kitBlocks? (no snapshot) - live list is added at per-kit x zone qty
    expect(partQty(c, "Pillar Candle")).toBe("4");
    expect(kitBadge(html, 8)).toBe(true);
  });

  it("edited: Pillar Candle 3x4=12, Chimney 0.5x4=2, Shamadhan 1.75x4=7, others 4; badge KIT · 8", () => {
    const html = combinedBook(selWith(consoleEl({ kitOverrides: OVERRIDES })));
    const c = kitCard(html, "Cabinets Console");
    expect(c).toBeTruthy();
    expect(partQty(c, "Pillar Candle")).toBe("12");
    expect(partQty(c, "CHIMNEY CANDLE STAND")).toBe("2");
    expect(partQty(c, "China Shamadhan 3 size")).toBe("7");
    for (const n of ["Golden Brass leaf Pot", "Round Fibre Pot Medium", "Golden Brass Surahi Pot", "Books", "Wooden Chester Box"]) expect(partQty(c, n)).toBe("4");
    expect(c.parts).toHaveLength(8);
    expect(c.qty).toBe("4");
    expect(kitBadge(html, 8)).toBe(true);
  });

  it("edited and ALSO held by Deal Check with an older snapshot: the edited list wins, per-kit x zone qty", () => {
    const sel = selWith(consoleEl({ kitOverrides: OVERRIDES }), { deptInventory: { Floral: [snapKit(4)] } });
    const html = combinedBook(sel);
    const c = kitCard(html, "Cabinets Console");
    expect(partQty(c, "Pillar Candle")).toBe("12");
    expect(partQty(c, "CHIMNEY CANDLE STAND")).toBe("2");
    expect(partQty(c, "China Shamadhan 3 size")).toBe("7");
    expect(c.parts).toHaveLength(8);
    // exactly one card for the kit
    expect(cards(html).filter(x => x.icon === "📦" && x.name === "Cabinets Console")).toHaveLength(1);
  });

  it("edited, a part removed and one added; held snapshot still has the removed one: removed absent, added present", () => {
    const ov = [{ itemId: "p1", qty: 1 }, { itemId: "p4", qty: 3 }, { itemId: "p9", qty: 2 }]; // p2,p3,p5..p8 removed, p9 added
    const sel = selWith(consoleEl({ kitOverrides: ov }), { deptInventory: { Floral: [snapKit(4)] } });
    const c = kitCard(combinedBook(sel), "Cabinets Console");
    expect(c.parts.map(p => p.name).sort()).toEqual(['Brass <Diya> & "Co"', "Golden Brass leaf Pot", "Pillar Candle"].sort());
    expect(partQty(c, "Pillar Candle")).toBe("12");
    expect(partQty(c, 'Brass <Diya> & "Co"')).toBe("8");
  });

  it("HTML escaping of a part name", () => {
    const sel = selWith(consoleEl({ kitOverrides: [{ itemId: "p9", qty: 1 }] }));
    const html = combinedBook(sel);
    expect(html).toContain("Brass &lt;Diya&gt; &amp; &quot;Co&quot;");
    expect(html).not.toContain("<Diya>");
  });

  it("a flower part's real % shows as a tag on the parts card (70% real -> Artificial 30% . Real 70%)", () => {
    const sel = selWith(consoleEl({ kitOverrides: OVERRIDES }));
    const html = combinedBook(sel, { flowerPatterns: patterns });
    const c = kitCard(html, "Cabinets Console");
    const pot = c.parts.find(p => p.name === "Round Fibre Pot Medium");
    expect(pot.tags.join(" ")).toContain("Real 70%");
    expect(pot.tags.join(" ")).toContain("Artificial 30%");
  });

  it("flower recipes still stay out of the combined book (recipe card, bunches, foam) while the kit card prints", () => {
    const sel = selWith(consoleEl({ kitOverrides: OVERRIDES }), {
      floralPlan: { artificial: { flowerBunches: 9, greenBunches: 7 } },
      floralDetail: [{ realZones: [{ zone: "installations", el: "Chandelier Recipe", kitParent: "Cabinets Console", lines: [{ name: "floral foam", qty: 2, unit: "pc" }] }],
        artZones: [{ zone: "installations", el: "Chandelier Recipe", kitParent: "Cabinets Console", flower: 9, green: 7, qty: 1 }] }],
    });
    const html = combinedBook(sel, { flowerPatterns: patterns });
    expect(kitCard(html, "Cabinets Console")).toBeTruthy();
    expect(html).not.toContain("Chandelier Recipe");
    expect(html).not.toContain("floral foam");
    expect(html).not.toContain("Artificial flowers");
    expect(html).not.toContain("Artificial greens");
    expect(html).not.toContain("🌸");
  });

  it("the Floral single-department book still prints the kit's recipe lines (bunches / foam) on the kit's card", () => {
    const sel = selWith(consoleEl(), {
      deptInventory: { Floral: [snapKit(4)] },
      floralPlan: { artificial: { flowerBunches: 9, greenBunches: 7 } },
      floralDetail: [{ realZones: [{ zone: "installations", el: "Chandelier Recipe", kitParent: "Cabinets Console", lines: [{ name: "floral foam", qty: 2, unit: "pc" }] }],
        artZones: [{ zone: "installations", el: "Chandelier Recipe", kitParent: "Cabinets Console", flower: 9, green: 7, qty: 1 }] }],
    });
    const html = singleBook("Floral", sel, { flowerPatterns: patterns, blockedItemsGrouped: [{ id: "Floral:k", invId: "kit1", name: "Cabinets Console", qty: 4, isKit: true, components: snapKit(4).components, sub: "" }] });
    const c = kitCard(html, "Cabinets Console");
    expect(c).toBeTruthy();
    expect(html).toContain("Artificial flowers");
    expect(html).toContain("floral foam");
  });
});

describe("floral kit: per-zone and per-element correctness", () => {
  it("the same kit in TWO zones with different overrides and counts: each card uses its own element's list and count", () => {
    const sel = baseSel({
      installations: [consoleEl({ qty: 4, kitOverrides: OVERRIDES })],
      entrance: [consoleEl({ qty: 2, kitOverrides: [{ itemId: "p4", qty: 5 }, { itemId: "p7", qty: 1 }] })],
    });
    const html = combinedBook(sel);
    const cs = cards(html).filter(c => c.icon === "📦" && c.name === "Cabinets Console");
    expect(cs).toHaveLength(2);
    const big = cs.find(c => c.qty === "4"), small = cs.find(c => c.qty === "2");
    expect(partQty(big, "Pillar Candle")).toBe("12");
    expect(big.parts).toHaveLength(8);
    expect(partQty(small, "Pillar Candle")).toBe("10"); // 5 x 2
    expect(partQty(small, "Books")).toBe("2");
    expect(small.parts).toHaveLength(2);
  });

  it("the same kit in TWO zones, one edited and one never edited (Deal Check snapshot for 6 kits): each its own list", () => {
    const sel = baseSel({
      installations: [consoleEl({ qty: 4, kitOverrides: [{ itemId: "p4", qty: 3 }] })],
      entrance: [consoleEl({ qty: 2 })],
    }, { deptInventory: { Floral: [snapKit(6, PARTS.slice(0, 3))] } });
    const html = combinedBook(sel);
    const cs = cards(html).filter(c => c.icon === "📦" && c.name === "Cabinets Console");
    expect(cs).toHaveLength(2);
    const edited = cs.find(c => c.qty === "4"), plain = cs.find(c => c.qty === "2");
    expect(edited.parts.map(p => p.name)).toEqual(["Pillar Candle"]);
    expect(partQty(edited, "Pillar Candle")).toBe("12");
    // the never-edited zone keeps the snapshot parts (a 2/6 share of each part's total 6 -> 2)
    expect(plain.parts.map(p => p.name)).toEqual(expect.arrayContaining(["Golden Brass leaf Pot", "Round Fibre Pot Medium", "Golden Brass Surahi Pot"]));
    expect(plain.parts.every(p => parseFloat(p.qty) === 2)).toBe(true);
  });

  it("two rows of the same kit in ONE zone, each with its own kitOverrides: two cards, each with ITS parts at ITS count - no edit is lost", () => {
    // each differently-edited row keeps its own card (merge key carries the kitOverrides)
    const sel = baseSel({ installations: [
      consoleEl({ qty: 2, kitOverrides: [{ itemId: "p4", qty: 3 }] }),
      consoleEl({ qty: 2, kitOverrides: [{ itemId: "p4", qty: 1 }, { itemId: "p7", qty: 1 }] }),
    ] });
    const all = cards(combinedBook(sel)).filter(c => c.icon === "📦" && c.name === "Cabinets Console");
    expect(all).toHaveLength(2);
    expect(partQty(all[0], "Pillar Candle")).toBe("6"); // 3 per kit x 2
    expect(partQty(all[0], "Books")).toBeUndefined();
    expect(partQty(all[1], "Pillar Candle")).toBe("2"); // 1 per kit x 2
    expect(partQty(all[1], "Books")).toBe("2");
  });
  it("two rows edited the SAME way still merge into one card at the summed count", () => {
    const ov = [{ itemId: "p4", qty: 3 }];
    const sel = baseSel({ installations: [consoleEl({ qty: 1, kitOverrides: ov }), consoleEl({ qty: 2, kitOverrides: ov })] });
    const all = cards(combinedBook(sel)).filter(c => c.icon === "📦" && c.name === "Cabinets Console");
    expect(all).toHaveLength(1);
    expect(partQty(all[0], "Pillar Candle")).toBe("9"); // 3 per kit x 3
  });
  it("an edited kit row and a never-edited row of the same kit in ONE zone: two cards, the edited one's own list, the other the master list", () => {
    const sel = baseSel({ installations: [
      consoleEl({ qty: 1, kitOverrides: [{ itemId: "p4", qty: 3 }] }),
      consoleEl({ qty: 1 }),
    ] });
    const all = cards(combinedBook(sel)).filter(c => c.icon === "📦" && c.name === "Cabinets Console");
    expect(all).toHaveLength(2);
    expect(partQty(all[0], "Pillar Candle")).toBe("3");
    expect(all[0].parts).toHaveLength(1);
    expect(partQty(all[1], "Pillar Candle")).toBe("1");
    expect(all[1].parts.length).toBeGreaterThan(1);
  });

  it("an empty kitOverrides [] (every part removed) and no snapshot: no kit badge, no card (it.kit is 0) - the item stays as a plain card", () => {
    const html = combinedBook(selWith(consoleEl({ kitOverrides: [] })));
    expect(kitCard(html, "Cabinets Console")).toBeUndefined();
    expect(html).toContain("Cabinets Console");
    expect(html).not.toContain("KIT ·");
  });

  it("an empty kitOverrides [] while Deal Check still holds the kit: it must not print the stale snapshot parts as if Build had them", () => {
    const sel = selWith(consoleEl({ kitOverrides: [] }), { deptInventory: { Floral: [snapKit(4)] } });
    const html = combinedBook(sel);
    const c = kitCard(html, "Cabinets Console");
    // Build has NO parts now: either no card at all or an empty one; the 8 snapshot parts must not show
    expect(c ? c.parts.length : 0).toBe(0);
  });

  it("held kit edited down to 3 parts: the KIT badge on the zone card agrees with the 3-part card", () => {
    const sel = selWith(consoleEl({ kitOverrides: [{ itemId: "p1", qty: 1 }, { itemId: "p4", qty: 3 }, { itemId: "p7", qty: 1 }] }), { deptInventory: { Floral: [snapKit(4)] } });
    const html = combinedBook(sel);
    const c = kitCard(html, "Cabinets Console");
    expect(c.parts).toHaveLength(3);
    expect(kitBadge(html, c.parts.length)).toBe(true); // "KIT · 3"
  });

  it("an override part whose inventory item no longer exists is silently dropped; a qty-0 part is dropped; the rest print", () => {
    const html = combinedBook(selWith(consoleEl({ kitOverrides: [{ itemId: "gone", qty: 2 }, { itemId: "p1", qty: 0 }, { itemId: "p4", qty: 3 }] })));
    const c = kitCard(html, "Cabinets Console");
    expect(c.parts.map(p => p.name)).toEqual(["Pillar Candle"]);
    expect(kitBadge(html, 1)).toBe(true);
  });

  it("an override list whose every part is gone/0 behaves as an empty kit: no card", () => {
    const html = combinedBook(selWith(consoleEl({ kitOverrides: [{ itemId: "gone", qty: 2 }, { itemId: "p1", qty: 0 }] })));
    expect(kitCard(html, "Cabinets Console")).toBeUndefined();
  });

  it("decimal counts round to 2 places and do not drift (0.1 x 3 kits = 0.3, 0.333 x 3 = 1, 1.25 x 3 = 3.75)", () => {
    const html = combinedBook(selWith(consoleEl({ qty: 3, kitOverrides: [{ itemId: "p1", qty: 0.1 }, { itemId: "p2", qty: 0.333 }, { itemId: "p3", qty: 1.25 }] })));
    const c = kitCard(html, "Cabinets Console");
    expect(partQtyRaw(c, "Golden Brass leaf Pot")).toBe("0.3");
    expect(partQtyRaw(c, "Round Fibre Pot Medium")).toBe("1");
    expect(partQtyRaw(c, "Golden Brass Surahi Pot")).toBe("3.75");
  });

  it("a part's unit prints after its qty (kg) and the kit qty has no unit", () => {
    const inv2 = [...inventory.filter(i => i.id !== "p4"), { id: "p4", name: "Pillar Candle", category: "Florals", unit: "kg" }];
    const html = combinedBook(selWith(consoleEl({ kitOverrides: [{ itemId: "p4", qty: 0.5 }] })), { inventory: inv2 });
    const c = kitCard(html, "Cabinets Console");
    expect(partQtyRaw(c, "Pillar Candle")).toBe("2 kg");
  });

  it("a kit with 12 long-named parts and several more kits: renders without throwing, every card present, spread over pages", () => {
    const longParts = Array.from({ length: 12 }, (_, i) => ({ id: "L" + i, name: `Extra Long Antique Hand Painted Brass Bowl Decorative Piece Number ${i} With A Very Long Name`, category: "Florals" }));
    const bigKit = { id: "bk", name: "Big Kit", category: "Florals", subItems: longParts.map(p => ({ itemId: p.id, qty: 1 })) };
    const kits = Array.from({ length: 6 }, (_, i) => ({ id: "K" + i, name: "Kit " + i, category: "Florals", subItems: PARTS.slice(0, 8).map(p => ({ itemId: p.id, qty: 1 })) }));
    const els = [{ name: "Big Kit", invId: "bk", qty: 2, kitOverrides: longParts.map(p => ({ itemId: p.id, qty: 2 })) }, ...kits.map(k => ({ name: k.name, invId: k.id, qty: 1, kitOverrides: OVERRIDES }))];
    let html;
    expect(() => { html = combinedBook(baseSel({ installations: els }), { inventory: [...inventory, ...longParts, bigKit, ...kits] }); }).not.toThrow();
    const cs = cards(html).filter(c => c.icon === "📦");
    expect(cs).toHaveLength(7);
    expect(cs.find(c => c.name === "Big Kit").parts).toHaveLength(12);
    expect(partQty(cs.find(c => c.name === "Big Kit"), longParts[0].name)).toBe("4");
    const pages = html.split('<section data-block data-page class="zp">').filter(s => s.includes('class="kb"'));
    expect(pages.length).toBeGreaterThan(1);
  });
});

describe("floral kit: flower-recipe (patternId) parts in kitOverrides", () => {
  const ov = [{ itemId: "p4", qty: 3 }, { patternId: "fp2", qty: 2 }];
  it("combined book: the recipe part (dept Floral) must not print on the kit's parts card ('recipes out of the combined book')", () => {
    const html = combinedBook(selWith(consoleEl({ kitOverrides: ov })), { flowerPatterns: patterns });
    const c = kitCard(html, "Cabinets Console");
    expect(c.parts.map(p => p.name)).not.toContain("Chandelier Recipe");
  });
  it("Floral single book: the recipe part prints (Floral's own recipe line)", () => {
    const sel = selWith(consoleEl({ kitOverrides: ov }), { deptInventory: { Floral: [snapKit(4, [PARTS[3]])] } });
    const html = singleBook("Floral", sel, { flowerPatterns: patterns, blockedItemsGrouped: [{ id: "Floral:k", invId: "kit1", name: "Cabinets Console", qty: 4, isKit: true, components: snapKit(4).components }] });
    const c = kitCard(html, "Cabinets Console");
    expect(c.parts.map(p => p.name)).toContain("Chandelier Recipe");
  });
  it("Tenting single book: a Floral recipe part is not on a Tenting kit's card", () => {
    const comps = [{ name: "Tree Branch Bar", qty: 2, imsId: "t1" }];
    const sel = selWith({ name: "Tent Tree", invId: "kit2", qty: 1, kitOverrides: [{ itemId: "t1", qty: 2 }, { patternId: "fp2", qty: 2 }] },
      { deptInventory: { Tenting: [{ name: "Tent Tree", imsId: "kit2", qty: 1, isKit: true, components: comps }] } });
    const html = singleBook("Tenting", sel, { flowerPatterns: patterns, blockedItemsGrouped: [{ id: "Tenting:k", invId: "kit2", name: "Tent Tree", qty: 1, isKit: true, components: comps }] });
    const c = kitCard(html, "Tent Tree");
    expect(c.parts.map(p => p.name)).toEqual(["Tree Branch Bar"]);
  });
});

describe("single-department books and other departments' kits are unchanged", () => {
  const heldFloral = [{ id: "Floral:k", invId: "kit1", name: "Cabinets Console", qty: 4, isKit: true, components: snapKit(4).components }];
  it("Floral single book, edited kit: only Floral's own parts (Shamadhan / Box belong to Structure) at per-kit x kits", () => {
    const sel = selWith(consoleEl({ kitOverrides: OVERRIDES }), { deptInventory: { Floral: [snapKit(4)] } });
    const c = kitCard(singleBook("Floral", sel, { blockedItemsGrouped: heldFloral }), "Cabinets Console");
    expect(c.parts.map(p => p.name)).not.toContain("China Shamadhan 3 size");
    expect(c.parts.map(p => p.name)).not.toContain("Wooden Chester Box");
    expect(c.parts).toHaveLength(6);
    expect(partQty(c, "Pillar Candle")).toBe("12");
    expect(partQty(c, "CHIMNEY CANDLE STAND")).toBe("2");
  });
  it("Structure single book (the kit shell is on Floral's sheet, Structure holds two parts): no whole-kit card of Floral's parts", () => {
    const sel = selWith(consoleEl({ kitOverrides: OVERRIDES }), { deptInventory: { Floral: [snapKit(4, PARTS.slice(0, 5))], Structure: [{ name: "China Shamadhan 3 size", imsId: "p6", qty: 4, fromKit: "Cabinets Console" }, { name: "Wooden Chester Box", imsId: "p8", qty: 4, fromKit: "Cabinets Console" }] } });
    const html = singleBook("Structure", sel, { blockedItemsGrouped: [{ id: "Structure:a", invId: "p6", name: "China Shamadhan 3 size", qty: 4, fromKit: "Cabinets Console" }, { id: "Structure:b", invId: "p8", name: "Wooden Chester Box", qty: 4, fromKit: "Cabinets Console" }] });
    expect(html).not.toContain("Pillar Candle");
    expect(html).toContain("China Shamadhan 3 size");
  });
  it("Floral single book: a kit never edited keeps Deal Check's snapshot parts at the snapshot counts", () => {
    const comps3 = snapKit(4, PARTS.slice(0, 3));
    const sel = selWith(consoleEl(), { deptInventory: { Floral: [comps3] } });
    const c = kitCard(singleBook("Floral", sel, { blockedItemsGrouped: [{ ...heldFloral[0], components: comps3.components }] }), "Cabinets Console");
    expect(c.parts.map(p => p.name)).toEqual(expect.arrayContaining(["Golden Brass leaf Pot", "Round Fibre Pot Medium", "Golden Brass Surahi Pot"]));
    expect(partQty(c, "Golden Brass leaf Pot")).toBe("4");
  });
  it("another department's kit (Tenting tree) in the combined book: unchanged, edited and never edited", () => {
    const plain = combinedBook(selWith({ name: "Tent Tree", invId: "kit2", qty: 2 }));
    const c1 = kitCard(plain, "Tent Tree");
    expect(c1.parts.map(p => p.name)).toEqual(expect.arrayContaining(["Tree Branch Bar", "Pillar Candle"]));
    const edited = combinedBook(selWith({ name: "Tent Tree", invId: "kit2", qty: 2, kitOverrides: [{ itemId: "t1", qty: 5 }] }));
    const c2 = kitCard(edited, "Tent Tree");
    expect(c2.parts.map(p => p.name)).toEqual(["Tree Branch Bar"]);
    expect(partQty(c2, "Tree Branch Bar")).toBe("10");
  });
  it("a Tenting kit shell with a part on Floral's sheet (fromKit): the combined book prints the kit card once", () => {
    const sel = selWith({ name: "Tent Tree", invId: "kit2", qty: 1 }, { deptInventory: {
      Tenting: [{ name: "Tent Tree", imsId: "kit2", qty: 1, isKit: true, components: [{ name: "Tree Branch Bar", qty: 2, imsId: "t1" }] }],
      Floral: [{ name: "Pillar Candle", imsId: "p4", qty: 1, fromKit: "Tent Tree" }] } });
    const html = combinedBook(sel);
    expect(cards(html).filter(c => c.icon === "📦" && c.name === "Tent Tree")).toHaveLength(1);
  });
});

describe("Hindi book with a Floral kit", () => {
  it("builds the combined Hindi book with the edited kit card, no throw, counts intact", () => {
    let html;
    expect(() => { html = combinedBook(selWith(consoleEl({ kitOverrides: OVERRIDES })), {}, { lang: "hi" }); }).not.toThrow();
    expect(html).toContain("📦");
    const cs = cards(html).filter(c => c.icon === "📦");
    expect(cs).toHaveLength(1);
    expect(cs[0].parts).toHaveLength(8);
    expect(cs[0].parts.map(p => parseFloat(p.qty)).sort((a, b) => a - b)).toEqual([2, 4, 4, 4, 4, 4, 7, 12]);
  });
});
