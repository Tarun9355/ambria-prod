import { useEffect, useState } from "react";

// Shared store for `blocks` reservation shortfalls that need to stay VISIBLE until resolved or
// dismissed (Phase 4, 2026-11-14 inventory-blocks audit, finding F3). Deliberately a SIBLING of
// src/lib/saveHealth.js, not a reuse of it: a save-health "problem" means the write itself FAILED
// (SaveHealthBanner's beforeunload warning exists because that data is at risk of being lost) — a
// stock shortfall means the write SUCCEEDED, just for less than was asked (apply_block_ops' own 'cap'
// mode), so nothing here is at risk on a reload and this store never blocks beforeunload. Before this,
// reconcileSoldInventoryBlocks surfaced a shortfall via a 2-second toast only — easy to miss entirely
// if it fired while the salesperson had already moved on to another client, and IMS never heard about
// it either (see the amend-log follow-up this phase deliberately left as a later, owner-decision step).
//
// Keyed by eventId (one entry per deal, replacing in place on a re-reconcile) rather than appended —
// a deal's own shortfall is a property of its CURRENT reservation, not a running log of every attempt.

const shortfalls = new Map(); // eventId -> {eventId, clientId, clientName, items, ts}
const listeners = new Set();

const snapshot = () => Array.from(shortfalls.values()).sort((a, b) => a.ts - b.ts);
const notify = () => { const snap = snapshot(); listeners.forEach((fn) => fn(snap)); };

// items: [{itemId, name, date, requested, granted, short}]. Replaces any existing entry for this
// eventId outright (not merged) — a fresh reconcile's own report is the complete, current picture.
export const reportStockShortfall = (eventId, { clientId, clientName, items }) => {
  if (!eventId || !Array.isArray(items) || !items.length) return;
  shortfalls.set(eventId, { eventId, clientId, clientName, items, ts: Date.now() });
  notify();
};

export const clearStockShortfall = (eventId) => {
  if (shortfalls.delete(eventId)) notify();
};

// Same action as clearStockShortfall — named separately so a caller's intent (the person dismissed it
// vs. a clean reconcile resolved it) stays readable at the call site.
export const dismissStockShortfall = (eventId) => clearStockShortfall(eventId);

export const getStockShortfalls = () => snapshot();

export const useStockShortfalls = () => {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    setSnap(snapshot()); // a report/clear between the initializer and this effect must not be missed
    listeners.add(setSnap);
    return () => listeners.delete(setSnap);
  }, []);
  return snap;
};
