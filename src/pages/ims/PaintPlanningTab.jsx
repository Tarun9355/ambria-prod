import { useState, useMemo } from "react";

// Faithful copy of the reference IMS PaintPlanningTab (Planning → Paint).
// Read-only central paint work-list derived from each function's blocked items.
export default function PaintPlanningTab({ projects, functions, inventory, settings }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFilter, setDateFilter] = useState("upcoming");
  const [expandedFns, setExpandedFns] = useState({});

  const colourCat = settings?.colourCatalogue || [];
  const getHex = (name) => { const c = colourCat.find((x) => x.name === name); return c?.hex || "#ccc"; };

  const paintWork = useMemo(() => {
    const work = [];
    (functions || []).forEach((fn) => {
      if (!fn.items || fn.items.length === 0) return;
      const proj = (projects || []).find((p) => p.id === fn.projectId || (p.functions || []).includes(fn.id));
      const customItems = [];
      const baseItems = [];

      fn.items.forEach((it) => {
        const inv = (inventory || []).find((i) => i.id === it.invId);
        const itemName = inv?.name || it.invId || "Unknown";
        const baseColour = inv?.baseColour || "Ivory";
        const totalQty = Number(it.qty) || 1;

        let allocs = [];
        if (Array.isArray(it.paintAllocation) && it.paintAllocation.length > 0) {
          allocs = it.paintAllocation.filter((a) => a && Number(a.qty) > 0 && a.colour && a.colour !== baseColour)
            .map((a) => ({ qty: Number(a.qty), colour: String(a.colour) }));
        } else if (it.paintOverride && String(it.paintOverride).trim() && String(it.paintOverride).trim() !== baseColour) {
          allocs = [{ qty: totalQty, colour: String(it.paintOverride) }];
        }

        if (allocs.length > 0) {
          const allocatedQty = allocs.reduce((s, a) => s + a.qty, 0);
          const baseQty = Math.max(0, totalQty - allocatedQty);
          customItems.push({ itemName, baseColour, totalQty, allocs, baseQty, invId: it.invId });
        } else {
          baseItems.push({ itemName, baseColour, totalQty, invId: it.invId });
        }
      });

      if (customItems.length > 0 || baseItems.length > 0) {
        work.push({
          fnId: fn.id, fnName: fn.name || "Unnamed", fnDate: fn.date || "", fnType: fn.type || "",
          venue: fn.venue?.name || "TBD", projName: proj?.name || "", projStatus: proj?.status || "",
          customItems, baseItems,
          totalCustomPieces: customItems.reduce((s, ci) => s + ci.allocs.reduce((ss, a) => ss + a.qty, 0), 0),
          totalBasePieces: baseItems.reduce((s, bi) => s + bi.totalQty, 0) + customItems.reduce((s, ci) => s + ci.baseQty, 0),
        });
      }
    });
    work.sort((a, b) => (a.fnDate || "9999").localeCompare(b.fnDate || "9999"));
    return work;
  }, [functions, projects, inventory]);

  const filtered = dateFilter === "all"
    ? paintWork
    : dateFilter === "upcoming"
      ? paintWork.filter((w) => w.fnDate >= today)
      : paintWork.filter((w) => w.fnDate === dateFilter);

  const toggleFn = (fnId) => setExpandedFns((prev) => ({ ...prev, [fnId]: !prev[fnId] }));
  const upcomingDates = [...new Set(paintWork.filter((w) => w.fnDate >= today).map((w) => w.fnDate))].sort().slice(0, 14);

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">🎨 Paint Planning</h2>
          <p className="text-sm text-gray-500">Central paint work-list across all events — no pricing, just what to paint</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{filtered.length} function{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setDateFilter("upcoming")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${dateFilter === "upcoming" ? "bg-pink-600 text-white border-pink-600" : "bg-white text-gray-600 border-gray-300 hover:border-pink-400"}`}>
          Upcoming
        </button>
        <button onClick={() => setDateFilter("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${dateFilter === "all" ? "bg-pink-600 text-white border-pink-600" : "bg-white text-gray-600 border-gray-300 hover:border-pink-400"}`}>
          All
        </button>
        {upcomingDates.map((d) => (
          <button key={d} onClick={() => setDateFilter(d)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${dateFilter === d ? "bg-pink-100 text-pink-800 border-pink-400" : "bg-white text-gray-500 border-gray-200 hover:border-pink-300"}`}>
            {new Date(d + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </button>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <div className="bg-pink-50 border border-pink-200 rounded-lg px-4 py-2 flex-1 text-center">
          <div className="text-lg font-bold text-pink-700">{filtered.reduce((s, w) => s + w.totalCustomPieces, 0)}</div>
          <div className="text-xs text-pink-600">Custom paint pieces</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 flex-1 text-center">
          <div className="text-lg font-bold text-gray-600">{filtered.reduce((s, w) => s + w.totalBasePieces, 0)}</div>
          <div className="text-xs text-gray-500">Base touch-up pieces</div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 flex-1 text-center">
          <div className="text-lg font-bold text-purple-700">{filtered.length}</div>
          <div className="text-xs text-purple-600">Functions</div>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm italic">
          No paint work {dateFilter === "upcoming" ? "for upcoming events" : dateFilter === "all" ? "found" : "on this date"}.
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((w) => {
          const isExpanded = expandedFns[w.fnId] !== false;
          return (
            <div key={w.fnId} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <button onClick={() => toggleFn(w.fnId)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-sm font-bold text-gray-900">{w.fnName}</span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-500">{w.fnDate ? new Date(w.fnDate + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "No date"}</span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-500">📍 {w.venue}</span>
                  {w.projName && <span className="text-xs text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full">{w.projName}</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {w.totalCustomPieces > 0 && (
                    <span className="text-xs font-bold text-pink-700 bg-pink-50 px-2 py-0.5 rounded-full">🖌 {w.totalCustomPieces} paint</span>
                  )}
                  {w.totalBasePieces > 0 && (
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{w.totalBasePieces} base</span>
                  )}
                  <span className="text-gray-400 text-sm">{isExpanded ? "▾" : "▸"}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                  {w.customItems.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-pink-700 mb-2 flex items-center gap-1">🖌 Custom Paint ({w.customItems.length} item{w.customItems.length > 1 ? "s" : ""})</div>
                      <div className="space-y-2">
                        {w.customItems.map((ci, i) => (
                          <div key={ci.invId + ":" + i} className="bg-pink-50 border border-pink-100 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold text-gray-800">{ci.itemName}</span>
                              <span className="text-xs text-gray-400">× {ci.totalQty} total</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {ci.allocs.map((a, ai) => (
                                <div key={ai} className="flex items-center gap-1.5 bg-white border border-pink-200 rounded-md px-2 py-1">
                                  <div className="w-3.5 h-3.5 rounded-sm border border-gray-300" style={{ background: getHex(a.colour) }} />
                                  <span className="text-xs font-bold text-pink-800">{a.colour}</span>
                                  <span className="text-xs text-gray-500">× {a.qty}</span>
                                </div>
                              ))}
                              {ci.baseQty > 0 && (
                                <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-md px-2 py-1">
                                  <div className="w-3.5 h-3.5 rounded-sm border border-gray-300" style={{ background: getHex(ci.baseColour) }} />
                                  <span className="text-xs text-gray-500">{ci.baseColour} (base)</span>
                                  <span className="text-xs text-gray-400">× {ci.baseQty}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {w.baseItems.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-gray-500 mb-2">Base Colour — Touch-up ({w.baseItems.length} item{w.baseItems.length > 1 ? "s" : ""})</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {w.baseItems.map((bi, i) => (
                          <div key={bi.invId + ":" + i} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-md px-2.5 py-1.5">
                            <div className="w-3 h-3 rounded-sm border border-gray-200" style={{ background: getHex(bi.baseColour) }} />
                            <span className="text-xs text-gray-700 truncate">{bi.itemName}</span>
                            <span className="text-xs text-gray-400 ml-auto flex-shrink-0">× {bi.totalQty} · {bi.baseColour}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 italic text-center mt-6">💡 Group items by colour for batch painting. Custom colours first, then base touch-ups.</p>
    </div>
  );
}
