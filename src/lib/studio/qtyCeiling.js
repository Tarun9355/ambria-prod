// What happens to a quantity typed into an element's box when stock puts a ceiling on it (Build).
//   typed   the number the person committed        current  the element's quantity right now
//   cap     what stock covers on the date, or null for an element with no ceiling
// → { qty, wantedQty?, clamped?, refused? }
//   · at or under the ceiling, or not an increase: taken as typed.
//   · an increase past the ceiling from a row that is under it: held AT the ceiling, and wantedQty remembers
//     what was asked for so the card can say "short · N asked".
//   · a row already ABOVE the ceiling (saved before the ceiling existed) is not allowed to go higher: refused.
export function applyQtyCeiling({ typed, current, cap }) {
  const cur = Number(current) || 0;
  const want = Number(typed) || 0;
  if (cap == null || !Number.isFinite(Number(cap)) || want <= cap || want <= cur) return { qty: want };
  if (cur > cap) return { qty: cur, refused: true };
  return { qty: cap, wantedQty: want, clamped: true };
}
