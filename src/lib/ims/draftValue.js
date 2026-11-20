// What a DraftInput (components/ui) shows. While it is being typed in: the draft. Right after the person leaves it: the text they
// committed, until the prop has caught up with it (the save and the realtime refetch take a moment - on a slow connection seconds - and
// the old value used to flash back in the meantime, so a typed price looked as if it had not been taken and "appeared" a while later,
// owner report 2026-11-20). Once the prop changes (the saved value arrived, normalised or not) the prop is shown again.
//   held: { raw, base } - the committed text and the prop value it was committed against, or null.
export function shownValue({ draft, held, value }) {
  if (draft !== null && draft !== undefined) return draft;
  const v = value ?? "";
  if (held && String(v) === String(held.base ?? "")) return held.raw;
  return v;
}
