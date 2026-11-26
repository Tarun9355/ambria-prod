// ── A TRUCK'S VEHICLE / DRIVER ARE FIXED ONCE IT IS LOADED ── (owner ask 2026-11-26) Truck 1 of an event had its vehicle, driver
// and phone typed over (another vehicle's) after its first trip had gone out with a printed challan, so that trip - and the Site
// page - showed the wrong truck. Once anything is on any of its trips, or a trip has left, the truck's vehicle no. and driver can
// no longer be changed: a different vehicle is a new truck ("+ Add truck"). An empty phone can still be filled in.
export const truckLoadedOf = (t) => (Array.isArray(t?.trips) && t.trips.length ? t.trips : [t || {}]).some((tr) =>
  (tr?.status && tr.status !== "loading")
  || ["loads", "extra"].some((k) => Object.values(tr?.[k] || {}).some((ld) => Object.values(ld || {}).some((q) => Number(q) > 0)))
  || Object.values(tr?.custom || {}).some((rows) => (Array.isArray(rows) ? rows : []).some((c) => Number(c?.qty) > 0)));
export const truckDetailsLocked = (t) => !!(String(t?.vehicle || "").trim() && String(t?.driver || "").trim()) && truckLoadedOf(t);
