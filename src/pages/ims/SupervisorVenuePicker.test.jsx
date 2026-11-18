import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// SupervisorVenues.jsx imports the live supabase client (which throws without env vars) - only the picker is rendered here.
vi.mock("../../lib/supabase", () => ({ supabase: {}, fetchAll: async () => [] }));
const { default: SupervisorVenuePicker } = await import("./SupervisorVenues.jsx");

const venues = {
  properties: [{ id: "p_ex", name: "Exotica" }, { id: "p_mk", name: "Manaktala" }, { id: "p_pu", name: "Pushpanjali" }, { id: "p_re", name: "Restro" }],
  inhouse: [{ id: "v_aura", name: "Aura", propertyId: "p_ex", parent: "Exotica" }, { id: "v_val", name: "Valencia", propertyId: "p_pu", parent: "Pushpanjali" }],
};
const render = (props) => renderToStaticMarkup(<SupervisorVenuePicker onChange={() => {}} venues={venues} {...props} />);
const options = (html) => [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);

describe("SupervisorVenuePicker (main venues only, c881a27e)", () => {
  it("nothing picked: placeholder + every main venue, no sub-venues, no optgroups", () => {
    const html = render({ value: [] });
    expect(options(html)).toEqual([["", "Select venue…"], ["p_ex", "Exotica"], ["p_mk", "Manaktala"], ["p_pu", "Pushpanjali"], ["p_re", "Restro"]]);
    expect(html).not.toContain("<optgroup");
    expect(html).not.toContain("Aura");
  });
  it("value undefined (pre-migration / just-added supervisor) behaves as nothing picked", () => {
    expect(options(render({ value: undefined }))[0]).toEqual(["", "Select venue…"]);
  });
  it("picked venues become tags and leave the dropdown; placeholder turns into '+ Add venue'", () => {
    const html = render({ value: ["p_ex", "p_pu"] });
    expect(options(html)).toEqual([["", "+ Add venue"], ["p_mk", "Manaktala"], ["p_re", "Restro"]]);
    expect(html).toContain('aria-label="Remove Exotica"');
    expect(html).toContain('aria-label="Remove Pushpanjali"');
  });
  it("a legacy sub-venue id still shows by name with its property, removable", () => {
    const html = render({ value: ["v_aura"] });
    expect(html).toContain("Aura · Exotica");
    expect(html).toContain('aria-label="Remove Aura · Exotica"');
  });
  it("an id no longer in the venues table shows as a deleted venue (amber), still removable", () => {
    const html = render({ value: ["gone"] });
    expect(html).toContain("⚠ deleted venue");
    expect(html).toContain("bg-amber-50");
    expect(html).toContain('aria-label="Remove venue"');
  });
  it("QUIRK: before the venues list has loaded, every picked tag reads '⚠ deleted venue' (no loading state)", () => {
    const html = renderToStaticMarkup(<SupervisorVenuePicker onChange={() => {}} venues={{ properties: [], inhouse: [] }} value={["p_ex"]} />);
    expect(html).toContain("⚠ deleted venue");
  });
  it("every venue picked: only the placeholder is left (the select still renders)", () => {
    expect(options(render({ value: venues.properties.map((p) => p.id) }))).toEqual([["", "+ Add venue"]]);
  });
  it("disabled (no fixed_venues column yet): select and remove buttons disabled, with the migration hint", () => {
    const html = render({ value: ["p_ex"], disabled: true });
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("Run migration 070 first");
  });
  it("the select is controlled at '' (it resets after each pick)", () => {
    const html = render({ value: [] });
    expect(html).toMatch(/<option value="" selected="">/);
  });
  it("duplicate ids in the stored value render (React would warn on the duplicate key) - documents that add() never creates them", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = render({ value: ["p_ex", "p_ex"] });
    expect((html.match(/Remove Exotica/g) || []).length).toBe(2);
    err.mockRestore();
  });
  it("venues prop missing entirely: renders with just the placeholder", () => {
    const html = renderToStaticMarkup(<SupervisorVenuePicker onChange={() => {}} value={[]} />);
    expect(options(html)).toEqual([["", "Select venue…"]]);
  });
});
