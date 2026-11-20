import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { saveVariantsFresh } from "./mandiVariants";

// Independent review of 97d08ee6 (mandi variant photos disappearing). These tests run the REAL code sliced out of
// AdminSettingsTab.jsx (the per-row saveVariants definition and each variant edit's own statement) against a fake
// supabase + updateRow, so a change to that wiring is exercised, not just the helper.

const SRC_DIR = resolve(__dirname, "../..");
const ADMIN = readFileSync(join(SRC_DIR, "pages/ims/AdminSettingsTab.jsx"), "utf8").replace(/\r\n/g, "\n");

function slice(src, start, end, { from = 0 } = {}) {
  const i = src.indexOf(start, from);
  if (i < 0) throw new Error("start marker not found: " + start);
  const j = src.indexOf(end, i + start.length);
  if (j < 0) throw new Error("end marker not found: " + end);
  return src.slice(i, j + end.length);
}

// --- the real code, sliced -------------------------------------------------------------------------------------------
const ROW_CODE = slice(ADMIN, "const recalcParentLowest = (variantList) => {", "}).catch(() => {});");
const WITH_PREV_PRICE = slice(ADMIN, "function withPrevPrice(history, price) {", "\n}\n");
const PRICE_EDIT = slice(ADMIN, "saveVariants((list) => list.map((cv) => cv.variantId === v.variantId ? { ...cv, priceHistory:", "cv), true);");
const exact = (s) => { if (!ADMIN.includes(s)) throw new Error("statement not found in AdminSettingsTab.jsx: " + s); return s; };
const RENAME = exact("saveVariants((list) => list.map((cv) => cv.variantId === v.variantId ? { ...cv, name: nv } : cv));");
const PHOTO = exact("saveVariants((list) => list.map((cv) => cv.variantId === v.variantId ? { ...cv, photoUrl: url } : cv));");
const DELETE = exact("saveVariants((list) => { const rest = list.filter((cv) => cv.variantId !== v.variantId); return rest.length ? rest : list; }, true);");
const ADD = slice(ADMIN, "saveVariants((list) => [...list, { variantId: newVId,", "]);");
const TOGGLE_PALETTE = slice(ADMIN, "const togglePalette = (c) => {", "}));\n") + "};";
const UPDATE_ROW_WRAPPER = slice(ADMIN, "const updateRow = canEdit ? rawUpdateRow :", ";\n");

// a fake mandi_flowers table: one stored color_variants list per id, with an optional read delay (network latency)
function fakeDb(initial, { readDelay = 0, readFails = false } = {}) {
  const rows = { ...initial };
  const reads = [];
  const writes = [];
  const supabase = {
    from: (table) => ({
      select: (cols) => ({
        eq: (col, id) => ({
          single: async () => {
            reads.push({ table, cols, col, id });
            const snapshot = structuredClone(rows[id]);           // what the database holds at READ time
            if (readDelay) await new Promise((r) => setTimeout(r, readDelay));
            if (readFails) return { data: null, error: { message: "timeout" } };
            return { data: { color_variants: snapshot }, error: null };
          },
        }),
      }),
    }),
  };
  const rawUpdateRow = vi.fn(async (table, id, patch) => {
    writes.push({ table, id, patch: structuredClone(patch) });
    rows[id] = structuredClone(patch.color_variants);
    return { id };
  });
  return { rows, reads, writes, supabase, rawUpdateRow };
}

function buildRow(p, db, { canEdit = true } = {}) {
  const updateRow = new Function("canEdit", "rawUpdateRow", UPDATE_ROW_WRAPPER + "\nreturn updateRow;")(canEdit, db.rawUpdateRow);
  return new Function("p", "supabase", "updateRow", "saveVariantsFresh", ROW_CODE + "\nreturn { saveVariants, recalcParentLowest };")(
    p, db.supabase, updateRow, saveVariantsFresh);
}
const withPrevPrice = new Function(WITH_PREV_PRICE + "\nreturn withPrevPrice;")();
const run = (stmt, scope) => {
  const names = Object.keys(scope);
  return new Function(...names, "return " + stmt.replace(/;$/, ""))(...names.map((n) => scope[n]));
};

const V = (id, extra = {}) => ({ variantId: id, name: id, photoUrl: null, currentPrice: 10, priceHistory: [], ...extra });
const PHOTO_URL = "https://cdn/x/rose-red.jpg";

describe("the original loss, through the real AdminSettingsTab wiring", () => {
  it("a price edit from a screen copy that has not received the new photo keeps the photo", async () => {
    const db = fakeDb({ F1: [V("red", { photoUrl: PHOTO_URL }), V("white", { currentPrice: 40 })] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red"), V("white", { currentPrice: 40 })] };   // stale: no photo
    const { saveVariants } = buildRow(screen, db);
    await run(PRICE_EDIT, { saveVariants, v: screen.colorVariants[1], nv: 25, withPrevPrice });
    expect(db.reads[0]).toMatchObject({ table: "mandi_flowers", cols: "color_variants", col: "id", id: "F1" });
    const { patch } = db.writes[0];
    expect(patch.color_variants[0].photoUrl).toBe(PHOTO_URL);
    expect(patch.color_variants[1].currentPrice).toBe(25);
    // the previous price recorded is the STORED one (fresh cv), and the flower's price is the lowest of the fresh list
    expect(patch.color_variants[1].priceHistory.at(-1).price).toBe(40);
    expect(patch.current_price).toBe(10);
  });

  it("price history's previous price comes from the fresh row, not the screen (someone else changed it meanwhile)", async () => {
    const db = fakeDb({ F1: [V("red", { currentPrice: 55 })] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red", { currentPrice: 50 })] };
    const { saveVariants } = buildRow(screen, db);
    await run(PRICE_EDIT, { saveVariants, v: screen.colorVariants[0], nv: 60, withPrevPrice });
    expect(db.writes[0].patch.color_variants[0].priceHistory.at(-1).price).toBe(55);
    expect(db.writes[0].patch.current_price).toBe(60);
  });

  it("a variant rename from a stale copy keeps the photo and the other fields", async () => {
    const db = fakeDb({ F1: [V("red", { photoUrl: PHOTO_URL, currentPrice: 33, palette: ["Red"] }), V("white")] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red"), V("white")] };
    const { saveVariants } = buildRow(screen, db);
    await run(RENAME, { saveVariants, v: screen.colorVariants[0], nv: "Rose Deep Red" });
    const [red, white] = db.writes[0].patch.color_variants;
    expect(red).toMatchObject({ name: "Rose Deep Red", photoUrl: PHOTO_URL, currentPrice: 33, palette: ["Red"] });
    expect(white.variantId).toBe("white");
    expect(Object.keys(db.writes[0].patch)).toEqual(["color_variants"]);   // a rename never touches current_price
  });

  it("a photo upload keeps a price someone else saved meanwhile", async () => {
    const db = fakeDb({ F1: [V("red"), V("white", { currentPrice: 99 })] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red"), V("white", { currentPrice: 10 })] };
    const { saveVariants } = buildRow(screen, db);
    await run(PHOTO, { saveVariants, v: screen.colorVariants[0], url: PHOTO_URL });
    expect(db.writes[0].patch.color_variants).toEqual([V("red", { photoUrl: PHOTO_URL }), V("white", { currentPrice: 99 })]);
  });

  it("+ Add Variant keeps the stored photos; Delete keeps a variant someone else added meanwhile", async () => {
    const db = fakeDb({ F1: [V("red", { photoUrl: PHOTO_URL }), V("white"), V("pink")] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red"), V("white")] };
    const { saveVariants } = buildRow(screen, db);
    await run(ADD, { saveVariants, newVId: "Vnew", p: screen });
    expect(db.writes[0].patch.color_variants.map((x) => x.variantId)).toEqual(["red", "white", "pink", "Vnew"]);
    expect(db.writes[0].patch.color_variants[0].photoUrl).toBe(PHOTO_URL);
    await run(DELETE, { saveVariants, v: screen.colorVariants[1] });
    expect(db.writes[1].patch.color_variants.map((x) => x.variantId)).toEqual(["red", "pink", "Vnew"]);
    expect(db.writes[1].patch.current_price).toBe(10);
  });

  it("a photo upload for a variant someone else deleted meanwhile is dropped (no resurrection, list otherwise unchanged)", async () => {
    const db = fakeDb({ F1: [V("red")] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red"), V("gone")] };
    const { saveVariants } = buildRow(screen, db);
    await run(PHOTO, { saveVariants, v: screen.colorVariants[1], url: PHOTO_URL });
    expect(db.writes[0].patch.color_variants).toEqual([V("red")]);
  });

  it("if the fresh read fails, the edit still goes out from the screen copy (old behaviour, not worse)", async () => {
    const db = fakeDb({ F1: [V("red", { photoUrl: PHOTO_URL })] }, { readFails: true });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red")] };
    const { saveVariants } = buildRow(screen, db);
    await run(RENAME, { saveVariants, v: screen.colorVariants[0], nv: "R" });
    expect(db.writes[0].patch.color_variants).toEqual([V("red", { name: "R" })]);
  });
});

describe("view-only users", () => {
  it("the component's own updateRow wrapper is the one saveVariants writes through: a view-only write is refused, silently", async () => {
    expect(ADMIN).toMatch(/import \{[^}]*\bupdateRow as rawUpdateRow\b[^}]*\} from "\.\.\/\.\.\/lib\/supabase"/);
    expect(ROW_CODE).toContain('write: (id, patch) => updateRow("mandi_flowers", id, patch),');
    const db = fakeDb({ F1: [V("red")] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red")] };
    const { saveVariants } = buildRow(screen, db, { canEdit: false });
    await expect(run(RENAME, { saveVariants, v: screen.colorVariants[0], nv: "X" })).resolves.toBeUndefined();
    expect(db.rawUpdateRow).not.toHaveBeenCalled();
    // the fresh read still happens for a view-only user (harmless SELECT on a table they can already read)
    expect(db.reads.length).toBe(1);
  });
});

describe("wiring order / scope", () => {
  it("recalcParentLowest and saveVariants are defined in the row's .map before every use", () => {
    const mapStart = ADMIN.indexOf("}).map((p) => {\n                const variants = Array.isArray(p.colorVariants)");
    const recalc = ADMIN.indexOf("const recalcParentLowest = (variantList) => {");
    const def = ADMIN.indexOf("const saveVariants = (change, priced = false) =>");
    expect(mapStart).toBeGreaterThan(0);
    expect(mapStart).toBeLessThan(recalc);
    expect(recalc).toBeLessThan(def);
    const uses = [...ADMIN.matchAll(/saveVariants\(\(list\) =>/g)].map((m) => m.index);
    expect(uses.length).toBe(6);
    // every use comes after the definition and before the next catalogue-row map / end of this map
    const nextMap = ADMIN.indexOf("}).map((p) => {", def);
    for (const u of uses) { expect(u).toBeGreaterThan(def); if (nextMap > 0) expect(u).toBeLessThan(nextMap); }
  });
});

describe("no other writer of color_variants in src", () => {
  const files = readdirSync(SRC_DIR, { recursive: true })
    .map(String).filter((f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f));
  const read = (f) => readFileSync(join(SRC_DIR, f), "utf8");

  it("color_variants is only ever written by saveVariantsFresh (and the row mappers)", () => {
    const hits = files.filter((f) => /color_variants/.test(read(f))).map((f) => f.replace(/\\/g, "/")).sort();
    expect(hits).toEqual(["lib/ims/flowerHelpers.js", "lib/ims/mandiVariants.js", "pages/ims/AdminSettingsTab.jsx"]);
    // in AdminSettingsTab it appears only in the fresh SELECT
    const lines = ADMIN.split("\n").filter((l) => l.includes("color_variants"));
    expect(lines.length).toBe(1);
    expect(lines[0].trim().startsWith("readFresh: async (id) =>")).toBe(true);
  });

  it("mandiFlowerToRow (writes the whole list) is only used for INSERTs of a brand-new flower", () => {
    for (const f of files) {
      const s = read(f);
      for (const m of s.matchAll(/mandiFlowerToRow\(/g)) {
        if (/export function mandiFlowerToRow\($/.test(s.slice(Math.max(0, m.index - 30), m.index + 17))) continue;
        expect(s.slice(m.index - 8, m.index), `${f} @${m.index}`).toBe(".insert(");
      }
    }
  });

  it("no mandiFlowerPatchToRow caller passes colorVariants", () => {
    for (const f of files) {
      const s = read(f);
      for (const m of s.matchAll(/mandiFlowerPatchToRow\(\{([^)]*)\}\)/g)) expect(m[1], f).not.toMatch(/colorVariants/);
    }
  });
});

describe("remaining holes", () => {
  // AdminSettingsTab.jsx:1414-1417: togglePalette computes the NEW palette from the screen's v.palette (vPalette) OUTSIDE the
  // fresh change and then writes it into the fresh variant. Clicking "Red" then "White" before the first save's realtime echo
  // reaches this screen (or another user's palette edit) is written away - the same stale-copy loss, one field down.
  it("fixed: palette toggle computes the new palette from the stale screen copy - a palette chip saved just before is lost", async () => {
    const db = fakeDb({ F1: [V("red", { palette: [] })] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red", { palette: [] })] };
    const { saveVariants } = buildRow(screen, db);
    // the real render scope: vPalette is derived from the row's v exactly as AdminSettingsTab.jsx:1414 does
    const v = screen.colorVariants[0];
    const vPalette = Array.isArray(v.palette) ? v.palette : [];
    const toggle = (c) => new Function("saveVariants", "v", "vPalette", "c", TOGGLE_PALETTE + "\nreturn togglePalette(c);")(saveVariants, v, vPalette, c);
    toggle("Red");                           // togglePalette returns nothing (fire-and-forget), so wait for its write to land
    await vi.waitFor(() => expect(db.writes.length).toBe(1));
    expect(db.rows.F1[0].palette).toEqual(["Red"]);   // saved; the screen has not re-rendered yet
    toggle("White");                         // same render's v.palette is still []
    await vi.waitFor(() => expect(db.writes.length).toBe(2));
    expect(db.rows.F1[0].palette.sort()).toEqual(["Red", "White"]);
  });

  // AdminSettingsTab.jsx:1185-1189 + mandiVariants.js:9-15: read then write is not atomic and NOT serialised per flower even inside
  // one tab. Two variant edits of the same flower in flight together (e.g. a photo upload finishing while a price/name commits,
  // or two quick edits) both read the same list, and the second write drops the first one's change. Window = one read RTT
  // (+ the write's own retry time) per edit, across tabs/users as well.
  it("fixed: two variant edits of one flower in flight together from the same screen - the second write drops the first's change", async () => {
    const db = fakeDb({ F1: [V("red"), V("white")] }, { readDelay: 20 });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red"), V("white")] };
    const { saveVariants } = buildRow(screen, db);
    await Promise.all([
      run(PHOTO, { saveVariants, v: screen.colorVariants[0], url: PHOTO_URL }),
      run(RENAME, { saveVariants, v: screen.colorVariants[1], nv: "Snow White" }),
    ]);
    expect(db.rows.F1[0].photoUrl).toBe(PHOTO_URL);
    expect(db.rows.F1[1].name).toBe("Snow White");
  });

  // AdminSettingsTab.jsx:1450: the "last variant" guard uses the screen's variantCount, but the filter now runs on the fresh list.
  // If the other variants were deleted elsewhere meanwhile, deleting this one leaves the flower with NO variants (current_price 0).
  it("fixed: deleting a variant when the stored list has only that one left empties color_variants (stale last-variant guard)", async () => {
    const db = fakeDb({ F1: [V("red", { photoUrl: PHOTO_URL })] });
    const screen = { id: "F1", name: "Rose", colorVariants: [V("red", { photoUrl: PHOTO_URL }), V("white")] };   // variantCount 2
    const { saveVariants } = buildRow(screen, db);
    await run(DELETE, { saveVariants, v: screen.colorVariants[0] });
    expect(db.rows.F1.length).toBeGreaterThan(0);
  });
});
