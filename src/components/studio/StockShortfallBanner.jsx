import { useStockShortfalls, dismissStockShortfall } from "../../lib/studio/stockShortfalls";

// Persistent, dismissable record of a deal whose `blocks` reservation came back CAPPED — some items
// couldn't be fully reserved because another booking already holds the stock (apply_block_ops' own
// 'cap' mode, migration 066) — surfaced by reconcileSoldInventoryBlocks (StudioApp.jsx) in place of a
// 2-second toast that could fire after the salesperson has already moved to another client (Phase 4,
// 2026-11-14 inventory-blocks audit, finding F3). Bottom-right, distinct corner from
// SaveHealthBanner.jsx (top-center) and the toast (also top-center) so none of the three ever overlap.
export default function StockShortfallBanner() {
  const shortfalls = useStockShortfalls();
  if (!shortfalls.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[9000] w-[calc(100%-2rem)] max-w-md flex flex-col gap-2">
      {shortfalls.map((s) => (
        <div key={s.eventId} className="rounded-xl border border-amber-300 bg-amber-50 shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-amber-800 min-w-0 truncate">
              ⚠ {s.clientName || "This booking"}: {s.items.length === 1 ? "an item" : `${s.items.length} items`} couldn't be fully reserved
            </span>
            <button onClick={() => dismissStockShortfall(s.eventId)} className="shrink-0 text-xs font-semibold text-amber-700 underline">
              Dismiss
            </button>
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {s.items.map((it, i) => (
              <li key={`${it.itemId}-${it.date}-${i}`} className="text-xs text-amber-700">
                <span className="font-medium">{it.name}</span>
                {" · "}{new Date(it.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                {": needs "}{it.requested}{", reserved "}{it.granted}{" — "}
                <span className="font-semibold">short {it.short}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
