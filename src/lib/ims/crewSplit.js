// "Today's N labours: Structure 6 · Lighting 4 · …" once a head has changed the day's crew. The plan's split
// (each department's own raw need that day) is laid over the crew actually set, so the line follows the edit
// instead of still showing the plan's numbers: every department with real work keeps at least one person
// (as long as there are enough people to go round), the rest go by the plan's proportions (largest remainder),
// and the parts add up to exactly the crew set.
//
//   raw    [{ dept, raw }]  the plan's own need per department (any scale - only the proportions are used)
//   total  the crew set for the day
// Returns [{ dept, count }] for the departments that get anyone, largest first.
export function splitCrewByDept(raw, total) {
  const n = Math.max(0, Math.round(Number(total) || 0));
  const list = (Array.isArray(raw) ? raw : []).map((x) => ({ dept: x.dept, raw: Math.max(0, Number(x.raw) || 0) })).filter((x) => x.raw > 0);
  if (!n || !list.length) return [];
  const sum = list.reduce((s, x) => s + x.raw, 0);
  // One each first, biggest need first, while there are people to go round.
  const byNeed = [...list].sort((a, b) => b.raw - a.raw);
  const count = new Map(list.map((x) => [x.dept, 0]));
  let left = n;
  for (const x of byNeed) { if (left <= 0) break; count.set(x.dept, 1); left--; }
  if (left > 0) {
    // The rest by proportion of what each department still needs beyond its first person.
    const want = list.map((x) => ({ dept: x.dept, w: Math.max(0, (x.raw / sum) * n - count.get(x.dept)) }));
    const wSum = want.reduce((s, x) => s + x.w, 0);
    const share = want.map((x) => ({ dept: x.dept, v: wSum > 0 ? (x.w / wSum) * left : left / want.length }));
    share.forEach((x) => count.set(x.dept, count.get(x.dept) + Math.floor(x.v)));
    let rest = n - [...count.values()].reduce((s, v) => s + v, 0);
    [...share].sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v))).forEach((x) => { if (rest > 0) { count.set(x.dept, count.get(x.dept) + 1); rest--; } });
  }
  return list.map((x) => ({ dept: x.dept, count: count.get(x.dept) })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
}
