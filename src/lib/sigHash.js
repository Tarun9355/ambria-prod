// A short fingerprint of a long "did anything change?" string. The planning snapshot used to store the whole
// signature on every event_orders row (deptIncomeSig ≈ 72 KB a row, 3.3 MB across the table) just to compare it
// with the next one; the fingerprint says the same thing in ~25 characters. Two independent 32-bit hashes plus
// the length, so a collision between two different plans is not a practical concern.
export function sigHash(str) {
  const s = String(str ?? "");
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return "h" + s.length.toString(36) + "." + (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
