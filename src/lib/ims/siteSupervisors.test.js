import { describe, it, expect } from "vitest";
import { siteSupervisorsFor } from "./fixedVenues";

// The supervisors fixed at an event's venue, for the Dept PDF cover (owner ask 2026-11-18).
const props = [{ id: "p_ex", name: "Exotica" }, { id: "p_pu", name: "Pushpanjali" }, { id: "p_mk", name: "Manaktala" }];
const sups = [
  { id: "1", name: "Raju", phone: "8447505495", active: true, fixedVenues: ["p_pu"] },
  { id: "2", name: "Raja", phone: "7607225147", active: true, fixedVenues: ["p_ex", "p_pu"] },
  { id: "3", name: "Manish", phone: "", active: true, fixedVenues: ["p_mk"] },
  { id: "4", name: "Old", phone: "1", active: false, fixedVenues: ["p_pu"] },
  { id: "5", name: "NoVenue", phone: "2", active: true, fixedVenues: [] },
  { id: "6", name: "PreMigration", phone: "3", active: true },
];
const settings = { venueParents: { Aura: "Exotica", Valencia: "Pushpanjali" } };

describe("site supervisors for an event's venue", () => {
  it("by the property's own name, active only, in roster order", () => {
    expect(siteSupervisorsFor(settings, ["Pushpanjali"], props, sups)).toEqual([
      { name: "Raju", phone: "8447505495" }, { name: "Raja", phone: "7607225147" },
    ]);
  });
  it("a sub-venue finds its parent property; 'Ambria ' and a name carrying the property match too", () => {
    expect(siteSupervisorsFor(settings, ["Aura"], props, sups).map((s) => s.name)).toEqual(["Raja"]);
    expect(siteSupervisorsFor(settings, ["Ambria Exotica"], props, sups).map((s) => s.name)).toEqual(["Raja"]);
    expect(siteSupervisorsFor(settings, ["Exotica Aura"], props, sups).map((s) => s.name)).toEqual(["Raja"]);
  });
  it("several functions at several venues: each supervisor once", () => {
    expect(siteSupervisorsFor(settings, ["Valencia", "Aura", "Manaktala"], props, sups).map((s) => s.name)).toEqual(["Raju", "Raja", "Manish"]);
  });
  it("an outside venue, or no properties / supervisors: nobody", () => {
    expect(siteSupervisorsFor(settings, ["Client farmhouse"], props, sups)).toEqual([]);
    expect(siteSupervisorsFor(settings, ["Pushpanjali"], [], sups)).toEqual([]);
    expect(siteSupervisorsFor(settings, ["Pushpanjali"], props, undefined)).toEqual([]);
    expect(siteSupervisorsFor(settings, [""], props, sups)).toEqual([]);
  });
  it("a property name inside another word does not match ('Exoticana')", () => {
    expect(siteSupervisorsFor(settings, ["Exoticana Lawn"], props, sups)).toEqual([]);
  });
});

describe("site supervisors - fixed at an in-house venue (dropdown)", () => {
  const places = [...props, { id: "v_aura", name: "Aura" }, { id: "v_val", name: "Valencia" }];
  const s2 = [
    { id: "a", name: "AuraGuy", phone: "1", active: true, fixedVenues: ["v_aura"] },
    { id: "b", name: "ExoticaGuy", phone: "2", active: true, fixedVenues: ["p_ex"] },
  ];
  it("an event at Aura: the Aura supervisor and the whole-Exotica one", () => {
    expect(siteSupervisorsFor(settings, ["Aura"], places, s2).map((s) => s.name)).toEqual(["AuraGuy", "ExoticaGuy"]);
  });
  it("an event at another Exotica venue: only the whole-Exotica one", () => {
    expect(siteSupervisorsFor({ venueParents: { Poolside: "Exotica" } }, ["Poolside"], places, s2).map((s) => s.name)).toEqual(["ExoticaGuy"]);
  });
  it("an event at Valencia (Pushpanjali): neither", () => {
    expect(siteSupervisorsFor(settings, ["Valencia"], places, s2)).toEqual([]);
  });
});
