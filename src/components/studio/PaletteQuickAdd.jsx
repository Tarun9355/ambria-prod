// A tiny "+ add a new palette, right here" control — dropped at the end of every colour-palette
// chip row a user tags photos or videos through. Palettes used to only be addable from Manage →
// Library's admin "🎨 Palettes" editor; a tagger who spotted a colour story that wasn't in the
// list yet had no way to add it in the moment. Clicking this reveals a one-line input; Enter (or
// the ✓) hands the typed name to `onAdd`, which is expected to write it into the shared palette
// catalogue AND select it on the tag being edited.
import { useState } from "react";

export default function PaletteQuickAdd({ onAdd, accent, border, textS, dense }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const fs = dense ? 9 : 10;

  if (!open) {
    return (
      <span onClick={() => setOpen(true)}
        style={{ padding: "3px 8px", fontSize: fs, borderRadius: 8, cursor: "pointer", border: `1px dashed ${border}`, color: accent, fontWeight: 600 }}>
        + Add palette
      </span>
    );
  }

  const submit = () => {
    const name = val.trim();
    if (name) onAdd(name);
    setVal("");
    setOpen(false);
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setVal(""); setOpen(false); } }}
        placeholder="New palette name…"
        style={{ fontSize: fs, padding: "2px 6px", borderRadius: 8, border: `1px solid ${accent}`, width: 130 }} />
      <span onClick={submit} title="Add" style={{ fontSize: fs + 2, color: accent, cursor: "pointer", fontWeight: 700, lineHeight: 1 }}>✓</span>
      <span onClick={() => { setVal(""); setOpen(false); }} title="Cancel" style={{ fontSize: fs + 1, color: textS, cursor: "pointer", lineHeight: 1 }}>✕</span>
    </span>
  );
}
