// ═══ SHARED PHOTO TAG FIELDS ═══
// The venue picker + one chip row per taxonomy category, used by BOTH the Manage → Library tag
// editor and Build's "Review Upload → <zone>" modal. Those two were separate implementations, and
// only the Library one had the full field set — a photo uploaded from Build could be given zone
// dimensions and elements but no event type, tier, palette, style, time or areas, so it landed in
// the library barely tagged and had to be corrected later from Manage.
//
// Callers own the tags object and hand back the next one; this owns only the presentation, so the
// two screens cannot drift apart the way they already had.
//
// `tags` shape matches library items: { venue: "Name", eventType: [...], colorPalette: [...], … }
// Every taxonomy key whose value is an array becomes a row, so a category added in Manage →
// Taxonomy appears on both screens with no code change.

import { useState } from "react";
import PaletteQuickAdd from "./PaletteQuickAdd.jsx";
import { addPaletteInline } from "../../lib/studio/colours.js";

export default function PhotoTagFields({
  tags, onChange,
  taxonomy, imsPaletteCatalogue, setImsPaletteCatalogue, savePaletteData,
  leafInhouseVenues = [], allInhouseVenues = [], allOutdoorDB = [],
  getTaxLabel,
  S, accent, accentText, border, textS, textP,
  dense = false,
}) {
  // Which venue group is open. Local: it is a view toggle, not part of the photo's tags.
  const [venueGroup, setVenueGroup] = useState("");
  const [outsideSub, setOutsideSub] = useState("all");

  const t = tags || {};
  const setTags = (patch) => onChange({ ...t, ...patch });
  const fs = dense ? 9 : 9.5;
  // Category headings carry the primary text colour and a little weight — at textS they sat the
  // same visual strength as the unselected chips beneath them, so the groups ran together.
  const label = { fontSize: dense ? 11.5 : 12, fontWeight: 600, color: textP || textS, marginBottom: 4 };
  const chip = (on) => ({
    padding: "3px 8px", fontSize: fs, borderRadius: 8, cursor: "pointer",
    border: `1px solid ${on ? accent : border}`,
    background: on ? `${accent}18` : "transparent",
    color: on ? accent : textS,
  });

  const curVenue = t.venue || "";
  const isInhouse = curVenue && allInhouseVenues.includes(curVenue);
  const activeGroup = venueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
  const outsideFiltered = (allOutdoorDB || []).filter((o) =>
    outsideSub === "empanelled" ? o.empanelled : outsideSub === "other" ? !o.empanelled : true);
  const setVenue = (val) => setTags({ venue: val || "" });

  return (
    <>
      {/* Venue — 2-level picker, same as Browse and the Library editor */}
      <div style={{ marginBottom: 6 }}>
        <div style={label}>Venue</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <div onClick={() => { setVenueGroup("inhouse"); setOutsideSub("all"); }} style={S.pill(activeGroup === "inhouse")}>Inhouse</div>
          <div onClick={() => { setVenueGroup("outside"); setOutsideSub("all"); }} style={S.pill(activeGroup === "outside")}>Outside</div>
          {curVenue && <div onClick={() => { setVenue(""); setVenueGroup(""); }}
            style={{ padding: "4px 8px", borderRadius: 12, fontSize: fs, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕ {curVenue}</div>}
        </div>
        {activeGroup === "inhouse" && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
          {leafInhouseVenues.map((vn) => { const on = curVenue === vn;
            return <div key={vn} onClick={() => setVenue(on ? "" : vn)}
              style={{ ...S.pill(on), background: on ? `${accent}22` : "transparent", color: on ? accentText : textS, border: `1px solid ${on ? accent + "55" : border}`, fontSize: fs, padding: "3px 8px" }}>{vn}</div>; })}
        </div>}
        {activeGroup === "outside" && <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {[["all", "All"], ["empanelled", "Empanelled"], ["other", "Other"]].map(([v, l]) =>
              <div key={v} onClick={() => setOutsideSub(v)} style={{ ...S.pill(outsideSub === v), fontSize: fs, padding: "3px 8px" }}>{l}</div>)}
          </div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
            {outsideFiltered.map((o) => { const on = curVenue === o.name;
              return <div key={o.name} onClick={() => setVenue(on ? "" : o.name)}
                style={{ ...S.pill(on), background: on ? `${accent}22` : "transparent", color: on ? accentText : textS, border: `1px solid ${on ? accent + "55" : border}`, fontSize: fs, padding: "3px 8px" }}>{o.name}{o.empanelled ? " ★" : ""}</div>; })}
          </div>
        </>}
      </div>

      {/* One row per taxonomy category. Palette prefers the live IMS catalogue over the taxonomy
          list, same as everywhere else. */}
      {Object.keys(taxonomy || {}).filter((k) => Array.isArray(taxonomy[k])).map((k) => {
        const vals = (k === "colorPalette" && (imsPaletteCatalogue || []).length > 0)
          ? imsPaletteCatalogue.map((p) => p.name)
          : taxonomy[k];
        return (
          <div key={k} style={{ marginBottom: 6 }}>
            <div style={label}>{k === "colorPalette" ? "Palette" : (getTaxLabel ? getTaxLabel(k) : k)}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {(vals || []).map((v) => {
                const sel = (t[k] || []).includes(v);
                return <span key={v} onClick={() => {
                  const cur = t[k] || [];
                  setTags({ [k]: sel ? cur.filter((x) => x !== v) : [...cur, v] });
                }} style={chip(sel)}>{v}</span>;
              })}
              {k === "colorPalette" && setImsPaletteCatalogue && (
                <PaletteQuickAdd dense={dense} accent={accent} border={border} textS={textS}
                  onAdd={(name) => {
                    const added = addPaletteInline(name, imsPaletteCatalogue, setImsPaletteCatalogue, savePaletteData);
                    if (!added) return;
                    const cur = t.colorPalette || [];
                    if (!cur.includes(added)) setTags({ colorPalette: [...cur, added] });
                  }} />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
