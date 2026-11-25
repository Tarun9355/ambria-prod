import { describe, it, expect } from "vitest";
import { siteSupervisorsFor, normVenue, venueWithParent } from "./fixedVenues";

// Edge cases for siteSupervisorsFor - who is printed on the Dept PDF cover as the event venue's site supervisor.
// `places` mirrors DepartmentOpsTab's call: [...properties, ...inhouse] from the venues table (useInhouseVenues).
const P = (id, name) => ({ id, name });
const V = (id, name, propertyId, parent) => ({ id, name, propertyId, parent });
const sup = (id, name, fixedVenues, extra = {}) => ({ id, name, phone: `9${id}`, active: true, fixedVenues, ...extra });
const names = (list) => list.map((s) => s.name);

const props = [P("p_ex", "Exotica"), P("p_pu", "Pushpanjali"), P("p_mk", "Manaktala")];
const inhouse = [
  V("v_aura", "Aura", "p_ex", "Exotica"),
  V("v_aurapool", "Aura Poolside", "p_ex", "Exotica"),
  V("v_val", "Valencia", "p_pu", "Pushpanjali"),
  V("v_pool", "Poolside", "p_pu", "Pushpanjali"),
];
const places = [...props, ...inhouse];
const settings = { venueParents: { Aura: "Exotica", "Aura Poolside": "Exotica", Valencia: "Pushpanjali", Poolside: "Pushpanjali" } };

describe("normVenue - what the matching ignores", () => {
  it("case, a leading 'Ambria ', outer spaces and trailing punctuation", () => {
    expect(normVenue("Ambria EXOTICA.  ")).toBe("exotica");
    expect(normVenue("exotica;:")).toBe("exotica");
    expect(normVenue("AMBRIA   Pushpanjali,")).toBe("pushpanjali");
    expect(normVenue(null)).toBe("");
    expect(normVenue(undefined)).toBe("");
  });
  it("'Ambria' only as a leading word (not 'Ambriana'), and only once", () => {
    expect(normVenue("Ambriana")).toBe("ambriana");
    expect(normVenue("Ambria Ambria Exotica")).toBe("ambria exotica");
  });
  it("leading whitespace is trimmed BEFORE the 'Ambria ' strip (fixed after the testing review), so '  Ambria Exotica' is 'exotica'", () => {
    expect(normVenue("  Ambria EXOTICA.  ")).toBe("exotica");
  });
});

describe("siteSupervisorsFor - name forms of the event's venue", () => {
  const sups = [sup("1", "ExGuy", ["p_ex"])];
  it.each([
    ["Exotica"], ["Ambria Exotica"], ["ambria exotica"], ["EXOTICA"], ["  Exotica  "], ["Exotica."], ["Exotica,"],
    ["Exotica Aura"], ["Ambria Exotica - Aura"], ["Exotica  Aura"],
  ])("'%s' finds the whole-Exotica supervisor", (venue) => {
    expect(names(siteSupervisorsFor(settings, [venue], places, sups))).toEqual(["ExGuy"]);
  });
  it("the property row itself named 'Ambria Exotica' in the venues table still matches a bare 'Exotica'", () => {
    expect(names(siteSupervisorsFor({}, ["Exotica"], [P("p_ex", "Ambria Exotica")], sups))).toEqual(["ExGuy"]);
  });
  it("venueWithParent's display string 'Pushpanjali › Valencia' still matches both the property and the sub-venue", () => {
    const s = [sup("1", "PuGuy", ["p_pu"]), sup("2", "ValGuy", ["v_val"])];
    const shown = venueWithParent(settings, "Valencia");
    expect(shown).toBe("Pushpanjali › Valencia");
    expect(names(siteSupervisorsFor(settings, [shown], places, s))).toEqual(["PuGuy", "ValGuy"]);
  });
  it("a property word glued to punctuation inside the name ('Exotica, Aura' / 'Exotica/Aura') is not found by containment", () => {
    // documents current behaviour: containment needs the place's name as a space-separated word
    const s = [sup("1", "ExGuy", ["p_ex"]), sup("2", "AuraGuy", ["v_aura"])];
    expect(names(siteSupervisorsFor(settings, ["Exotica, Aura"], places, s))).toEqual(["AuraGuy"]);
    expect(names(siteSupervisorsFor(settings, ["Exotica/Aura"], places, s))).toEqual([]);
  });
  it("a single string (not an array) of venue names works", () => {
    expect(names(siteSupervisorsFor(settings, "Exotica", places, sups))).toEqual(["ExGuy"]);
  });
});

describe("siteSupervisorsFor - parents (settings.venueParents)", () => {
  const s = [sup("1", "PuGuy", ["p_pu"]), sup("2", "ExGuy", ["p_ex"])];
  it("venueParents stored as a JSON string (how Studio saves it) is parsed", () => {
    const str = { venueParents: JSON.stringify({ Valencia: "Pushpanjali" }) };
    expect(names(siteSupervisorsFor(str, ["Valencia"], props, s))).toEqual(["PuGuy"]);
  });
  it("a malformed venueParents string does not throw - no parent link", () => {
    expect(siteSupervisorsFor({ venueParents: "{bad json" }, ["Valencia"], props, s)).toEqual([]);
  });
  it("venueParents is looked up by the EXACT stored name ('valencia' / 'Ambria Valencia' miss the parent)", () => {
    // documents current behaviour: parents[name] is not normalised
    expect(names(siteSupervisorsFor(settings, ["valencia"], props, s))).toEqual([]);
    expect(names(siteSupervisorsFor(settings, ["Ambria Valencia"], props, s))).toEqual([]);
  });
  it("no venueParents, but the sub-venue is in places: the sub-venue supervisor matches, the whole-property one does not", () => {
    // the venues table itself knows Valencia -> Pushpanjali (inhouse[].parent), but siteSupervisorsFor only reads settings.venueParents
    const s2 = [...s, sup("3", "ValGuy", ["v_val"])];
    expect(names(siteSupervisorsFor({}, ["Valencia"], places, s2))).toEqual(["ValGuy"]);
    expect(names(siteSupervisorsFor(undefined, ["Valencia"], places, s2))).toEqual(["ValGuy"]);
  });
});

describe("siteSupervisorsFor - sub-venues, look-alike names", () => {
  it("a sub-venue whose name carries its property's ('Aura Poolside' under Exotica): the whole-Exotica supervisor", () => {
    const s = [sup("1", "ExGuy", ["p_ex"])];
    expect(names(siteSupervisorsFor(settings, ["Aura Poolside"], places, s))).toEqual(["ExGuy"]);
  });
  it("Pushpanjali's 'Poolside' event does not pick up a supervisor fixed at Exotica's 'Aura Poolside'", () => {
    const s = [sup("1", "AuraPoolGuy", ["v_aurapool"])];
    expect(siteSupervisorsFor(settings, ["Poolside"], places, s)).toEqual([]);
  });
  // KNOWN ISSUE (review): word-containment is applied to sub-venues too, so a supervisor fixed ONLY at the 'Aura' hall is printed
  // on an event at the separate 'Aura Poolside' venue, and one fixed at Pushpanjali's 'Poolside' on every '... Poolside' event.
  it("FIXED: a supervisor fixed only at 'Aura' is not printed for an event at 'Aura Poolside'", () => {
    const s = [sup("1", "AuraGuy", ["v_aura"])];
    expect(siteSupervisorsFor(settings, ["Aura Poolside"], places, s)).toEqual([]);
  });
  it("FIXED: a supervisor fixed only at Pushpanjali's 'Poolside' is not printed for Exotica's 'Aura Poolside'", () => {
    const s = [sup("1", "PuPoolGuy", ["v_pool"])];
    expect(siteSupervisorsFor(settings, ["Aura Poolside"], places, s)).toEqual([]);
  });
  // KNOWN ISSUE: two properties where one name is a word-prefix of another.
  it("FIXED: 'Exotica Grand' (its own property) does not pick up the whole-Exotica supervisor", () => {
    const pp = [P("p_ex", "Exotica"), P("p_exg", "Exotica Grand")];
    const s = [sup("1", "ExGuy", ["p_ex"]), sup("2", "GrandGuy", ["p_exg"])];
    expect(names(siteSupervisorsFor({}, ["Exotica Grand"], pp, s))).toEqual(["GrandGuy"]);
  });
  it("one property name a prefix of another inside a word: 'Exotica' vs 'Exoticana' never cross", () => {
    const pp = [P("p_ex", "Exotica"), P("p_exa", "Exoticana")];
    const s = [sup("1", "ExGuy", ["p_ex"]), sup("2", "AnaGuy", ["p_exa"])];
    expect(names(siteSupervisorsFor({}, ["Exoticana"], pp, s))).toEqual(["AnaGuy"]);
    expect(names(siteSupervisorsFor({}, ["Exotica"], pp, s))).toEqual(["ExGuy"]);
  });
  it("a name that is both a property and a sub-venue (hall 'Manaktala' under property 'Manaktala'): both supervisors", () => {
    const pl = [P("p_mk", "Manaktala"), V("v_mk", "Manaktala", "p_mk", "Manaktala")];
    const s = [sup("1", "PropGuy", ["p_mk"]), sup("2", "HallGuy", ["v_mk"])];
    expect(names(siteSupervisorsFor({ venueParents: { Manaktala: "Manaktala" } }, ["Manaktala"], pl, s))).toEqual(["PropGuy", "HallGuy"]);
  });
  it("two same-named sub-venues under different properties are indistinguishable by name - both supervisors print", () => {
    // documents current behaviour: the event carries a venue NAME only
    const pl = [...props, V("v_pool_ex", "Poolside", "p_ex", "Exotica"), V("v_pool_pu", "Poolside", "p_pu", "Pushpanjali")];
    const s = [sup("1", "ExPool", ["v_pool_ex"]), sup("2", "PuPool", ["v_pool_pu"])];
    expect(names(siteSupervisorsFor({}, ["Poolside"], pl, s))).toEqual(["ExPool", "PuPool"]);
  });
});

describe("siteSupervisorsFor - the roster", () => {
  it("a supervisor fixed at several matching venues is printed once; roster order kept", () => {
    const s = [sup("1", "B", ["v_aura", "p_ex"]), sup("2", "A", ["p_ex"])];
    expect(names(siteSupervisorsFor(settings, ["Aura", "Exotica", "Aura Poolside"], places, s))).toEqual(["B", "A"]);
  });
  it("the same person entered twice in the roster prints twice (no de-dupe by name/phone)", () => {
    const s = [sup("1", "Raja", ["p_ex"]), sup("2", "Raja", ["p_ex"])];
    expect(names(siteSupervisorsFor(settings, ["Exotica"], places, s))).toEqual(["Raja", "Raja"]);
  });
  it("inactive (active:false) is left out; active missing or null counts as active", () => {
    const s = [sup("1", "Off", ["p_ex"], { active: false }), sup("2", "Unset", ["p_ex"], { active: undefined }), sup("3", "Null", ["p_ex"], { active: null })];
    expect(names(siteSupervisorsFor(settings, ["Exotica"], places, s))).toEqual(["Unset", "Null"]);
  });
  it("a missing phone gives '' ; name/phone trimmed; a blank or missing name is dropped", () => {
    const s = [
      { id: "1", name: "  Raja ", phone: " 7607225147 ", active: true, fixedVenues: ["p_ex"] },
      { id: "2", name: "NoPhone", active: true, fixedVenues: ["p_ex"] },
      { id: "3", name: "   ", phone: "1", active: true, fixedVenues: ["p_ex"] },
      { id: "4", phone: "2", active: true, fixedVenues: ["p_ex"] },
    ];
    expect(siteSupervisorsFor(settings, ["Exotica"], places, s)).toEqual([{ id: "1", name: "Raja", phone: "7607225147" }, { id: "2", name: "NoPhone", phone: "" }]);
  });
  it("a deleted venue id in fixedVenues is ignored; the supervisor's other venues still count", () => {
    const s = [sup("1", "Gone", ["v_deleted"]), sup("2", "Mixed", ["v_deleted", "p_ex"])];
    expect(names(siteSupervisorsFor(settings, ["Exotica"], places, s))).toEqual(["Mixed"]);
  });
  it("fixedVenues missing / not an array (pre-migration row, a bad value), null roster entries: never match, never throw", () => {
    const s = [{ id: "1", name: "Pre", active: true }, { id: "2", name: "Str", active: true, fixedVenues: "p_ex" }, null, undefined];
    expect(siteSupervisorsFor(settings, ["Exotica"], places, s)).toEqual([]);
  });
});

describe("siteSupervisorsFor - empty / undefined inputs never throw", () => {
  const s = [sup("1", "ExGuy", ["p_ex"])];
  it.each([
    ["no venue names", [undefined, places, s]],
    ["null venue names", [null, places, s]],
    ["empty venue list", [[], places, s]],
    ["only blanks", [["", "  ", null, undefined], places, s]],
    ["no places (venues not loaded yet)", [["Exotica"], [], s]],
    ["places null", [["Exotica"], null, s]],
    ["places with junk rows", [["Exotica"], [null, {}, { id: "x" }, { name: "Exotica" }, { id: "y", name: "  " }], s]],
    ["supervisors null", [["Exotica"], places, null]],
    ["supervisors empty", [["Exotica"], places, []]],
  ])("%s -> []", (_label, [vn, pl, sp]) => {
    expect(siteSupervisorsFor(settings, vn, pl, sp)).toEqual([]);
  });
  it("settings null / undefined is fine", () => {
    expect(names(siteSupervisorsFor(null, ["Exotica"], places, s))).toEqual(["ExGuy"]);
    expect(names(siteSupervisorsFor(undefined, ["Exotica"], places, s))).toEqual(["ExGuy"]);
  });
  // PLAUSIBLE (review): a legacy event order whose `venue` is an object ({ name }) - lib/ims/eventAutoConfirm.js still reads that shape.
  it("FIXED: an event venue given as an object { name } is matched by its name", () => {
    expect(names(siteSupervisorsFor(settings, [{ name: "Exotica" }], places, s))).toEqual(["ExGuy"]);
  });
});

// c881a27e (spec change): the dropdown lists main venues (properties) only; a sub-venue event counts under its property, resolved
// from the venues table (5th arg `inhouse`, [{ name, propertyId }]) as well as settings.venueParents. DeptOps passes
// properties = [...properties, ...inhouse] and inhouse = inhouse.
describe("siteSupervisorsFor - sub-venue -> main venue via the venues table (5th arg)", () => {
  const main = [sup("1", "ExGuy", ["p_ex"]), sup("2", "PuGuy", ["p_pu"]), sup("3", "MkGuy", ["p_mk"])];
  it.each([["Valencia", ["PuGuy"]], ["Poolside", ["PuGuy"]], ["Aura", ["ExGuy"]], ["Aura Poolside", ["ExGuy"]]])(
    "no venueParents at all: an event at '%s' finds its main venue's supervisor", (venue, want) => {
      expect(names(siteSupervisorsFor({}, [venue], places, main, inhouse))).toEqual(want);
    });
  it("the venues table resolves spellings venueParents misses ('valencia', 'Ambria Valencia', 'Valencia.')", () => {
    for (const v of ["valencia", "Ambria Valencia", "Valencia.", " VALENCIA "]) {
      expect(names(siteSupervisorsFor({}, [v], places, main, inhouse))).toEqual(["PuGuy"]);
    }
  });
  it("venueParents alone still works (inhouse not passed / empty / null)", () => {
    expect(names(siteSupervisorsFor(settings, ["Valencia"], props, main))).toEqual(["PuGuy"]);
    expect(names(siteSupervisorsFor(settings, ["Valencia"], props, main, null))).toEqual(["PuGuy"]);
    expect(names(siteSupervisorsFor(settings, ["Valencia"], props, main, []))).toEqual(["PuGuy"]);
  });
  it("both sources agree: counted once", () => {
    expect(names(siteSupervisorsFor(settings, ["Valencia"], places, main, inhouse))).toEqual(["PuGuy"]);
  });
  it("the two sources disagree (sub-venue moved to another property in the Venues editor, stale venueParents): both properties' supervisors print", () => {
    // documents current behaviour - a stale settings.venueParents is not overridden by the venues table
    const moved = [V("v_val", "Valencia", "p_mk", "Manaktala")];
    expect(names(siteSupervisorsFor(settings, ["Valencia"], props, main, moved))).toEqual(["PuGuy", "MkGuy"]);
  });
  it("an inhouse row whose propertyId is unknown / missing, or junk rows, is ignored", () => {
    const junk = [null, {}, { name: "Valencia" }, { name: "Valencia", propertyId: "p_gone" }];
    expect(siteSupervisorsFor({}, ["Valencia"], props, main, junk)).toEqual([]);
  });
  it("an outdoor / unknown venue name finds nobody", () => {
    expect(siteSupervisorsFor(settings, ["Client farmhouse"], places, main, inhouse)).toEqual([]);
  });
  it("the event at the property itself, and at the display string 'Pushpanjali › Valencia'", () => {
    expect(names(siteSupervisorsFor({}, ["Pushpanjali"], places, main, inhouse))).toEqual(["PuGuy"]);
    expect(names(siteSupervisorsFor({}, ["Pushpanjali › Valencia"], places, main, inhouse))).toEqual(["PuGuy"]);
  });
  it("two same-named sub-venues under different properties: the venues-table lookup keeps only the LAST one (Map overwrite)", () => {
    // documents current behaviour: a 'Poolside' at Exotica and at Pushpanjali -> the event resolves to whichever row came last
    const dup = [V("a", "Poolside", "p_ex", "Exotica"), V("b", "Poolside", "p_pu", "Pushpanjali")];
    expect(names(siteSupervisorsFor({}, ["Poolside"], props, main, dup))).toEqual(["PuGuy"]);
    expect(names(siteSupervisorsFor({}, ["Poolside"], props, main, dup.slice().reverse()))).toEqual(["ExGuy"]);
  });
  it("several functions at sub-venues of different properties: each main venue's supervisor once, roster order", () => {
    expect(names(siteSupervisorsFor({}, ["Aura", "Valencia", "Aura Poolside", undefined], places, main, inhouse))).toEqual(["ExGuy", "PuGuy"]);
  });
  it("a legacy sub-venue id still on a supervisor (picked before c881a27e) keeps matching that sub-venue's events", () => {
    const legacy = [sup("9", "AuraOnly", ["v_aura"])];
    expect(names(siteSupervisorsFor({}, ["Aura"], places, legacy, inhouse))).toEqual(["AuraOnly"]);
    expect(siteSupervisorsFor({}, ["Valencia"], places, legacy, inhouse)).toEqual([]);
  });
  it("FIXED: 'Exotica Grand' as a separate main venue still picks up the 'Exotica' supervisor (word containment)", () => {
    const pp = [P("p_ex", "Exotica"), P("p_exg", "Exotica Grand")];
    const s = [sup("1", "ExGuy", ["p_ex"]), sup("2", "GrandGuy", ["p_exg"])];
    expect(names(siteSupervisorsFor({}, ["Exotica Grand"], pp, s, []))).toEqual(["GrandGuy"]);
  });
});

describe("siteSupervisorsFor - with the inhouse list, as Dept Ops calls it", () => {
  it("a legacy sub-venue id matches its exact venue only; containment stays for main venues", () => {
    const s = [sup("1", "AuraOnly", ["v_aura"]), sup("2", "ExGuy", ["p_ex"])];
    expect(names(siteSupervisorsFor(settings, ["Aura Poolside"], places, s, inhouse))).toEqual(["ExGuy"]);
    expect(names(siteSupervisorsFor({}, ["Exotica Lawn"], places, s, inhouse))).toEqual(["ExGuy"]);
  });
});

describe("siteSupervisorsFor - carries the roster id", () => {
  it("each venue supervisor keeps its id, so the event header can tell one also added on the event (shown once) and leave them out of the picker", () => {
    const out = siteSupervisorsFor({}, ["Exotica"], props, [sup("1", "ExGuy", ["p_ex"]), sup("2", "Other", ["p_pu"])]);
    expect(out).toEqual([{ id: "1", name: "ExGuy", phone: "91" }]);
  });
});
