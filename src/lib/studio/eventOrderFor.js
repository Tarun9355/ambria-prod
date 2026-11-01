// The open deal's IMS event order. A client can carry several - a booking cancelled and booked again, a date moved and
// re-booked - and Studio used the first one in the list, whatever its status: Test 2's Build and Deal Check went on syncing
// into a cancelled order while IMS showed the live one, which never got the paint, the date or any change since
// (owner report 2026-11-01). The live order is the one: not cancelled first, then the newest.
// Matched by client id, else (an order from before ids) by client name.
const isCancelled = (e) => e?.status === "cancelled";
const createdOf = (e) => Number(e?.createdAt) || parseInt(String(e?.id || "").replace(/^eo_/, ""), 36) || 0;

export function eventOrderFor(eventOrders, clientId, clientName) {
  const list = Array.isArray(eventOrders) ? eventOrders.filter(Boolean) : [];
  let mine = clientId ? list.filter((e) => e.clientId === clientId) : [];
  if (!mine.length) {
    const name = String(clientName || "").trim();
    mine = list.filter((e) => (e.clientName || "") === name);
  }
  if (!mine.length) return undefined;
  return [...mine].sort((a, b) => (isCancelled(a) - isCancelled(b)) || (createdOf(b) - createdOf(a)))[0];
}
