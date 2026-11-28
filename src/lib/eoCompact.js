// ═══ event_orders.data: each crew "how" (trace) stored once ═══
//
// Why (owner report 2026-11-28: Studio and IMS tabs crash on tablets, Chrome's "Aw, Snap!" = out of memory): both apps load every
// event order whole. Measured on the live table: of ~33 MB of order data, manpowerDetail[dept][row].schedule[day].trace alone was
// 7.2 MB (plus 2.1 MB of row-level traces). The same trace is written many times over - the day's busiest function's trace again
// inside its own byFn, the setup day repeating it, and a shared crew's (Labours) whole schedule copied into every department's row.
//
// compactEoData (on every write of `data`): each distinct trace goes once into data.mpTraces, and every place that held it holds
// { "$mpTrace": key } instead. expandEoData (on every read into app state): the references are put back - all pointing at ONE
// object per trace, so memory holds it once too - and mpTraces is dropped. What every screen sees is exactly the order as it was
// before compacting (same keys, same order, same values - JSON.stringify of the expanded order is identical), so Dept Ops, the
// Site page, Deal Check and every signature/hash read the same data as before.
//
// An order saved before this (no mpTraces) reads as it is; its identical traces are also folded into one object in memory, and its
// next write stores it compacted. Only manpowerDetail's traces are touched - nothing else in the order changes.
// No reader may mutate a trace in place: after expandEoData one trace object can sit in many places (nothing does today - they are
// display-only, built fresh by Deal Check on every run).

const REF = "$mpTrace";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isRef = (v) => isObj(v) && typeof v[REF] === "string" && Object.keys(v).length === 1;
// Replace one key's value without moving it: a spread keeps every key where it was, so JSON.stringify comes out the same.
const withKey = (o, k, v) => (o[k] === v ? o : { ...o, [k]: v });

// Every trace in a manpowerDetail, passed through fn(trace) -> replacement: a row's own .trace and each schedule day's .trace.
// Returns the same object when nothing changed.
function mapTraces(md, fn) {
  if (!isObj(md)) return md;
  let changed = false;
  const out = {};
  for (const dept of Object.keys(md)) {
    const rows = md[dept];
    if (!Array.isArray(rows)) { out[dept] = rows; continue; }
    let rowsChanged = false;
    const nextRows = rows.map((r) => {
      if (!isObj(r)) return r;
      let nr = r;
      if (r.trace != null) nr = withKey(nr, "trace", fn(r.trace));
      if (Array.isArray(r.schedule)) {
        let schedChanged = false;
        const ns = r.schedule.map((s) => {
          if (!isObj(s) || s.trace == null) return s;
          const t = fn(s.trace);
          if (t === s.trace) return s;
          schedChanged = true;
          return withKey(s, "trace", t);
        });
        if (schedChanged) nr = withKey(nr, "schedule", ns);
      }
      if (nr !== r) rowsChanged = true;
      return nr;
    });
    out[dept] = rowsChanged ? nextRows : rows;
    if (rowsChanged) changed = true;
  }
  return changed ? out : md;
}

// A trace's per-function columns (byFn[i].trace) passed through fn as well. Same object back when nothing changed.
function mapByFn(t, fn) {
  if (!isObj(t) || !Array.isArray(t.byFn)) return t;
  let changed = false;
  const nb = t.byFn.map((b) => {
    if (!isObj(b) || b.trace == null) return b;
    const x = fn(b.trace);
    if (x === b.trace) return b;
    changed = true;
    return withKey(b, "trace", x);
  });
  return changed ? withKey(t, "byFn", nb) : t;
}

/**
 * The order as the app uses it: every { "$mpTrace": key } back to its trace (one shared object per key), mpTraces dropped, and
 * identical traces of an order saved the old way folded into one object. Anything that is not an order with traces comes back
 * as it is.
 */
export function expandEoData(data) {
  if (!isObj(data)) return data;
  const table = isObj(data.mpTraces) ? data.mpTraces : null;
  let base = data;
  if (table) { const { mpTraces: _drop, ...rest } = data; base = rest; } // eslint-disable-line no-unused-vars
  const md = base.manpowerDetail;
  if (!isObj(md)) return base;
  const byKey = new Map();   // ref key -> its one expanded object
  const byJson = new Map();  // trace JSON -> its one object (folds an old order's copies)
  const intern = (t) => {
    const j = JSON.stringify(t);
    const hit = byJson.get(j);
    if (hit) return hit;
    byJson.set(j, t);
    return t;
  };
  const resolving = new Set();
  const expand = (v) => {
    if (isRef(v)) {
      const k = v[REF];
      if (byKey.has(k)) return byKey.get(k);
      if (!table || !(k in table) || resolving.has(k)) return null; // a dangling or circular reference reads as no trace
      resolving.add(k);
      const t = intern(mapByFn(table[k], expand));
      resolving.delete(k);
      byKey.set(k, t);
      return t;
    }
    if (!isObj(v)) return v;
    return intern(mapByFn(v, expand));
  };
  const nextMd = mapTraces(md, expand);
  return nextMd === md ? base : { ...base, manpowerDetail: nextMd };
}

/**
 * The order as it is written to event_orders.data: each distinct trace once in mpTraces, references everywhere else. Takes an
 * order in either form (expanded, compacted, or a mix - a fresh manpowerDetail laid over a compacted row) and always rebuilds
 * mpTraces from what manpowerDetail holds now, so a stale table never rides along.
 */
export function compactEoData(data) {
  if (!isObj(data)) return data;
  const x = expandEoData(data);
  const md = x.manpowerDetail;
  if (!isObj(md)) return x;
  const table = {};
  const keyByJson = new Map();
  const refOf = (t) => {
    const j = JSON.stringify(t);
    let k = keyByJson.get(j);
    if (!k) { k = "t" + keyByJson.size; keyByJson.set(j, k); table[k] = t; }
    return { [REF]: k };
  };
  const compact = (v) => (isObj(v) ? refOf(mapByFn(v, compact)) : v);
  const nextMd = mapTraces(md, compact);
  if (!keyByJson.size) return x;
  return { ...x, manpowerDetail: nextMd, mpTraces: table };
}
