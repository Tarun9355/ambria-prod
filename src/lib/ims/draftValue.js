// What a DraftInput (components/ui) shows. While it is being typed in: the draft. Right after the person leaves it: the text they
// committed, until the prop has caught up with it (the save and the realtime refetch take a moment - on a slow connection seconds - and
// the old value used to flash back in the meantime, so a typed price looked as if it had not been taken and "appeared" a while later,
// owner report 2026-11-20). Once the prop shows what was committed (as text, or the same number), or after 8 s, the prop is shown again.
//   held: { raw, base } - the committed text and the prop value it was committed against, or null.
export function shownValue({ draft, held, value }) {
  if (draft !== null && draft !== undefined) return draft;
  const v = value ?? "";
  // the hold ends when the prop reaches the committed text (DraftInput) or after 8 s - an earlier save's echo in between (two quick
  // edits of the same box) does not bring an older value back
  if (held) return held.raw;
  return v;
}
