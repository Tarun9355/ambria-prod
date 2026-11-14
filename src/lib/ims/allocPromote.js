// IMS's auto-promote-on-sold effects (truss / platform / batta, IMS.jsx) remember which event
// orders they've already promoted only in a useRef — so the memory is wiped on every IMS page load.
// Each load therefore re-promoted EVERY sold EO on every date, re-saved those dates' allocation rows
// (each one a full copy into audit_log via the 037 trigger) and appended one *_audit row per date
// listing every EO id. With ~40 ops staff reloading all day, that is how truss_audit/platform_audit/
// batta_audit and audit_log grew into gigabytes.
//
// This answers "is this date already holding exactly this hard booking?" — if it is, the date is
// skipped, so nothing is recomputed, saved or audited. Only the fields the builder itself produces
// are compared (the allocator may add its own bookkeeping to an event; createdAt can fall back to
// Date.now()), so a real change to the EO's functions still re-promotes as before.

// Key-order-insensitive JSON: the stored entry comes back from a JSONB column, and JSONB does not
// keep object key order — a plain JSON.stringify of a nested object (trusses, per-material totals)
// would differ from the freshly built one every time and the skip would never fire.
// undefined-valued keys are dropped, as a JSON round trip drops them.
export const stableStringify = (v) => {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => stableStringify(x) ?? "null").join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
};

export const hardEntryUnchanged = (events, entry) => {
  const list = Array.isArray(events) ? events : [];
  if (list.some((ev) => ev?.state === "soft" && ev.clientId === entry.clientId)) return false;
  const cur = list.find((ev) => ev?.state === "hard" && ev.eoId === entry.eoId);
  if (!cur) return false;
  return Object.keys(entry).every((k) => k === "createdAt" || stableStringify(cur[k]) === stableStringify(entry[k]));
};
