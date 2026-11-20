// One of the allocation tables (truss / platform / batta) that failed to load when IMS opened is read again the moment someone changes it,
// instead of showing "… haven't loaded — reload the page" (owner ask 2026-11-20: that popup need not be shown). The change is applied
// once the table is in; the message is only for a table that still cannot be read. The guard itself stays: nothing is ever written
// on top of a table that has not really loaded (an empty list saved back would wipe every other event's allocation on those dates).
//
// loadOkRef: { current: { [key]: true | false | undefined } } - the page's "this table really loaded" flags.
// Returns true when the table is loaded afterwards (it already was, or this read worked), false when the read failed again.
export async function reloadAllocTable({ loadOkRef, key, fetchRows, toMap, ref, setState, onFail }) {
  if (loadOkRef.current[key] === true) return true;
  try {
    const rows = await fetchRows();
    // something else (the background retry, a realtime reload) got there first: leave what it put in
    if (loadOkRef.current[key] !== true) {
      const map = toMap(rows);
      ref.current = map;
      setState(map);
      loadOkRef.current[key] = true;
    }
    return true;
  } catch (e) {
    loadOkRef.current[key] = false;
    if (onFail) onFail(e);
    return false;
  }
}
