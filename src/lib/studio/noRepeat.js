// IMS → Inventory → Edit item → "Item repeats" switch (item.canRepeat). An item that does NOT repeat is
// never treated as reused: in a Repeat zone, at a Fixed Venue's standing stock or from an earlier
// function of the same deal it is still brought fresh — full price, trucked, counted in the build
// labour and never netted off as "already there". Anything else (flowers, candles, consumables) is
// what this is for.
//
// The Studio's pricing, transport and manpower code reads an item by its id in many places, so the set
// of non-repeating ids is kept here, refreshed whenever the inventory list changes, instead of
// threading the inventory through every one of them.
let nonRepeating = new Set();

export function setNonRepeatingItems(inventory) {
  nonRepeating = new Set((inventory || []).filter((i) => i && i.canRepeat === false).map((i) => i.id));
}

// False only for an item switched off in IMS; no id (a recipe / mandi element) and unknown ids repeat.
export const itemRepeats = (invId) => !(invId && nonRepeating.has(invId));
