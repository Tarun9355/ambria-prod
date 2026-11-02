// Build's zone reorder by drag (StudioBuild): when hovering another zone should move the dragged one into its place.

/** True once the pointer has crossed the MIDDLE of the hovered zone in the direction of travel: dragging down, past its
 *  middle; dragging up, above it. Swapping as soon as the pointer merely touched a zone made the list race back and
 *  forth - zones are tall and of different heights, so after one swap the pointer sat over yet another zone (or the
 *  same one again) and it swapped again (owner report 2026-11-02). */
export function crossedMiddle(fromIdx, toIdx, pointerY, top, height) {
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return false;
  const mid = top + height / 2;
  return fromIdx < toIdx ? pointerY > mid : pointerY < mid;
}
