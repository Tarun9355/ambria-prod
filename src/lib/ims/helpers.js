// Shared IMS helpers (faithful to the reference app).

// Next sequential id like "OH001" from an array of {id} objects.
export function nextId(arr, prefix = "") {
  const nums = arr.map((x) => parseInt((x.id || "0").replace(/\D/g, "")) || 0);
  return prefix + (nums.length ? Math.max(...nums) + 1 : 1).toString().padStart(3, "0");
}

// Total hours across an array of {start,end} time slots (handles past-midnight).
export function hoursFromSlots(slots) {
  return (slots || []).reduce((acc, s) => {
    let [sh, sm] = (s.start || "00:00").split(":").map(Number);
    let [eh, em] = (s.end || "00:00").split(":").map(Number);
    let h = eh * 60 + em - (sh * 60 + sm);
    if (h < 0) h += 24 * 60;
    return acc + h / 60;
  }, 0);
}

// Dihari (daily wage) with overtime multipliers.
export function calcDihari(hours, rate) {
  if (hours <= 8) return rate;
  if (hours <= 12) return rate * 1.5;
  return rate * 2;
}
