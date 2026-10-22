// The order the Build page lists a function's zones in, applied to any list of zone keys (IMS's PDFs use it).
//   1. zones the salesperson dragged into place (the function's `zoneOrder`), in the order dragged;
//   2. Admin → Zone Types' order (`adminOrder`);
//   3. the deal's own custom zones (`customKeys`), in the order they were added;
//   4. anything else, in the order given.
// Mirrors StudioApp's zoneOrderIndex (calcFunctionBreakdown), where dragged keys get negative ranks so they
// sort ahead of every other zone while keeping their own sequence.
export function orderZoneKeys(keys, { adminOrder = [], customKeys = [], dragged = [] } = {}) {
  const rank = {};
  adminOrder.forEach((k, i) => { rank[k] = i; });
  customKeys.forEach((k, i) => { if (!(k in rank)) rank[k] = adminOrder.length + i; });
  dragged.forEach((k, i) => { rank[k] = i - dragged.length; });
  const r = (k) => (k in rank ? rank[k] : Infinity);
  return [...keys].sort((a, b) => (r(a) === r(b) ? 0 : r(a) < r(b) ? -1 : 1));
}
