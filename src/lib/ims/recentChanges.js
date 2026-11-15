// What changed on a sold event in the last 48 hours (owner ask 2026-11-15): a warning on its Planning calendar chip, and inside the
// event a list of what changed, where, by whom - so ops notice a change before they set up from an old plan.
//
// Two sources, both already written by the app:
//   - the inventory a deal holds: Studio logs every change to a sold deal's blocked items as an amend_requests row per department
//     (status "logged", requestedAt / requestedBy, items [{ name, change: added | removed | changed | swapped, from, to, fromName }]);
//   - Dept Ops edits (actuals, manpower, truss, carpets, trucks, ...): event_orders.deptOps[dept].changes[section] = { at, by },
//     stamped by stampDeptChanges on every save there.

export const CHANGE_WINDOW_MS = 48 * 60 * 60 * 1000;

// Dept Ops save keys → the block (tile) they belong to, with its name. Unknown keys count as the plan in general.
const KEY_SECTION = {
  expenses: "actuals", mandiLines: "actuals", realMandi: "actuals", discount: "actuals",
  mp: "mp", mpOverrides: "mp", mpExtra: "mp", mpDay: "mp", mpWin: "mp", mpWinCount: "mp", mpWinBasis: "mp",
  trussPlan: "truss", trussFabric: "truss",
  carpetChoice: "carpet",
  itemChoice: "fabreq", shortAlloc: "inv",
  dispatch: "truck", loaded: "truck",
  dismantlePlan: "dism", dismantleSites: "dism",
  movements: "route", // logged on site after the event - the On-site view's Dismantle & routing block
};
// blocks that live on the On-site view, not Planning
export const ONSITE_SECTIONS = new Set(["route", "rcv", "oscrew"]);
export const SECTION_LABEL = {
  inv: "Inventory blocked", actuals: "Actuals", mp: "Manpower plan", truss: "Truss plan", carpet: "Carpet plan",
  truck: "Truck planning", dism: "Dismantle plan", fabreq: "Fabric plan", route: "Dismantle & routing", plan: "Plan",
};
// keys a save carries that are bookkeeping, not a change anyone made to the plan
const NOT_A_CHANGE = new Set(["updatedAt", "updatedBy", "changes", "seen", "mpSeen"]);

export const sectionOfKey = (k) => KEY_SECTION[k] || "plan";

// The department's `changes` after a save of `patch`: each block the patch touches stamped with when and by whom.
export function stampDeptChanges(prevChanges, patch, at, by) {
  const out = { ...(prevChanges && typeof prevChanges === "object" ? prevChanges : {}) };
  Object.keys(patch || {}).forEach((k) => {
    if (NOT_A_CHANGE.has(k)) return;
    out[sectionOfKey(k)] = { at, by: by || "—" };
  });
  return out;
}

const sign = { added: "+", removed: "−" };
// "+2 Round Table, −1 Chair, Ivory Couch → Beige Couch" - the first few, then "+3 more"
export function itemsSummary(items, max = 3) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const one = (it) => {
    const name = String(it.name || "Item").trim();
    if (it.change === "swapped") return `${String(it.fromName || "item").trim()} → ${name}`;
    if (it.change === "changed") return `${name} ${it.from ?? "?"} → ${it.to ?? "?"}`;
    const q = Number(it.qty ?? (it.change === "removed" ? it.from : it.to)) || 0;
    return `${sign[it.change] || ""}${q ? q + " " : ""}${name}`;
  };
  const shown = list.slice(0, max).map(one);
  return shown.join(", ") + (list.length > max ? ` +${list.length - max} more` : "");
}

// Every change to `eo` within `windowMs` of `now`, newest first: { at, by, dept, section, label, text, times }. The same change
// logged again and again (Studio re-logs a sold deal's inventory on every reconcile - one event showed 99 lines, most repeats) is
// one line: the newest, with how many times it was logged.
export function eventChanges(eo, amendRequests, now = Date.now(), windowMs = CHANGE_WINDOW_MS) {
  if (!eo) return [];
  const since = now - windowMs;
  const out = [];
  (amendRequests || []).forEach((r) => {
    if (!r || r.eventOrderId !== eo.id || r.status !== "logged") return;
    const at = Number(r.requestedAt) || 0;
    if (at < since || at > now + 60000) return;
    // names: the items as they stand now (added / changed / swapped in) - the rows to light up when the line is opened
    const names = (Array.isArray(r.items) ? r.items : []).filter((it) => it && it.change !== "removed").map((it) => String(it.name || "").trim()).filter(Boolean);
    out.push({ at, by: r.requestedBy || "—", dept: r.department || "", section: "inv", label: SECTION_LABEL.inv, text: itemsSummary(r.items), names });
  });
  Object.entries(eo.deptOps || {}).forEach(([dept, ops]) => {
    Object.entries((ops && ops.changes) || {}).forEach(([section, c]) => {
      const at = Number(c?.at) || 0;
      if (at < since || at > now + 60000) return;
      out.push({ at, by: c.by || "—", dept, section, label: SECTION_LABEL[section] || SECTION_LABEL.plan, text: "" });
    });
  });
  out.sort((a, b) => b.at - a.at);
  const seen = new Map();
  const merged = [];
  out.forEach((c) => {
    const k = `${c.dept}|${c.section}|${c.text}`;
    const first = seen.get(k);
    if (first) { first.times += 1; return; }
    const line = { ...c, times: 1 };
    seen.set(k, line);
    merged.push(line);
  });
  return merged;
}

// "just now", "25 min ago", "3 hrs ago", "30 hrs ago", "3 days ago" - hours right up to 48, not "yesterday": inside a 48-hour
// list "yesterday" read as older than the list claims (owner report 2026-11-15). "hrs", not "h": the Hindi screen reads words one
// by one, and a lone "h" would turn every "H 12 ft" into hours
export function agoText(at, now = Date.now()) {
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h <= 48) return `${h} ${h === 1 ? "hr" : "hrs"} ago`;
  return `${Math.round(h / 24)} days ago`;
}
