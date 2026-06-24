import { useState, useEffect } from "react";
import { Badge, Modal, Tabs } from "../../components/ui";
import { callClaudeStreaming } from "../../lib/ai";
import { PROD_STATUSES, PROD_DEPTS, DIM_UNITS } from "../../lib/ims/constants";

// Faithful rebuild of the reference IMS ProductionTab (Supply → Production sub-tab).
// Kanban board (drag & drop), Confirm & Add to Inventory (with AI photo comparison),
// History, plus the New Request / Confirm / Purchase modals and image lightbox.
export default function ProductionTab({ prodRequests, setProdRequests, inventory, setInventory, projects, functions, purchase, setPurchase }) {
  const [subTab, setSubTab] = useState("board");
  const [deptFilter, setDeptFilter] = useState("All");
  const [newModal, setNewModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // prodRequest id
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [aiComparing, setAiComparing] = useState(false);
  const [aiCompResult, setAiCompResult] = useState(null);
  const [purchaseModal, setPurchaseModal] = useState(null); // prodRequest id for purchase flow
  const [purchaseMode, setPurchaseMode] = useState("partial"); // "full" or "partial"
  const [materialLines, setMaterialLines] = useState([{ name: "", qty: "", unit: "Piece", estimatedCost: "", vendor: "", notes: "" }]);
  const [viewImg, setViewImg] = useState(null); // {src, title} or {slides, idx, title} for lightbox

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!viewImg) return;
    function handleKey(e) {
      if (e.key === "Escape") setViewImg(null);
      if (viewImg.slides) {
        if (e.key === "ArrowRight") setViewImg(v => ({ ...v, idx: ((v.idx || 0) + 1) % v.slides.length }));
        if (e.key === "ArrowLeft") setViewImg(v => ({ ...v, idx: ((v.idx || 0) - 1 + v.slides.length) % v.slides.length }));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [viewImg]);

  const blankForm = () => ({
    name: "", description: "", dimensions: { l: "", w: "", h: "", unit: "ft" },
    qty: 1, refImg: null, projectId: "", functionId: "", dept: "Floral",
    buildType: "function", notes: "",
  });
  const [form, setForm] = useState(blankForm());
  const [confirmForm, setConfirmForm] = useState({ finishedImg: null, finishedQty: 1, notes: "" });

  const filtered = prodRequests.filter(r => deptFilter === "All" || r.dept === deptFilter);
  const byStatus = {};
  PROD_STATUSES.forEach(s => { byStatus[s] = filtered.filter(r => r.status === s); });

  const fnOptions = form.projectId
    ? functions.filter(f => f.projectId === form.projectId)
    : functions;

  function deptToCategory(dept) {
    return { Floral: "Floral", Fabric: "Fabric", Lighting: "Lighting", Structural: "Structural",
      Furniture: "Furniture", Props: "Props", "Painter & Production": "Stage" }[dept] || "Props";
  }

  function createRequest() {
    if (!form.name.trim()) return;
    const id = "PROD" + String(prodRequests.length + 1).padStart(3, "0");
    setProdRequests(prev => [...prev, {
      ...form, id, raisedBy: "Priya Mehta",
      raisedDate: new Date().toISOString().split("T")[0],
      status: "Requested", finishedImg: null, finishedQty: null,
      aiComparison: null, confirmedBy: null, confirmedDate: null, inventoryId: null,
    }]);
    setForm(blankForm()); setNewModal(false);
  }

  function updateStatus(id, status) {
    setProdRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  function onDragStart(e, id) { setDragId(id); e.dataTransfer.effectAllowed = "move"; }
  function onDragOver(e, status) { e.preventDefault(); setDragOver(status); }
  function onDragLeave() { setDragOver(null); }
  function onDrop(e, status) {
    e.preventDefault();
    if (dragId) { updateStatus(dragId, status); }
    setDragId(null); setDragOver(null);
  }

  // ── AI photo comparison ──────────────────────────────────────────────────────
  async function runAIComparison(req, finishedImg) {
    if (!req.refImg || !finishedImg) return null;
    try {
      const refMedia = req.refImg.split(";")[0].split(":")[1];
      const refB64 = req.refImg.split(",")[1];
      const finMedia = finishedImg.split(";")[0].split(":")[1];
      const finB64 = finishedImg.split(",")[1];
      const compBlocks = [
        { type: "image", source: { type: "base64", media_type: refMedia, data: refB64 } },
        { type: "text", text: "This is the REFERENCE/DESIGN picture for a decoration item to be built." },
        { type: "image", source: { type: "base64", media_type: finMedia, data: finB64 } },
        { type: "text", text: `This is the FINISHED item photo taken by the production team.
Compare the two and return ONLY JSON:
{"result":"Match or Partial or Different","reason":"one line e.g. Colours and shape match closely"}
- Match: overall look, colours, shape closely resemble reference
- Partial: structure matches but some differences in colour/size/detail
- Different: significantly different from reference` },
      ];
      const text = await callClaudeStreaming({ contentBlocks: compBlocks, model: "claude-sonnet-4-6", maxTokens: 200 });
      return JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch (e) {
      return { result: "Unknown", reason: "AI comparison failed: " + e.message };
    }
  }

  // ── Confirm & Add to Inventory ───────────────────────────────────────────────
  async function confirmAndAdd(req) {
    const finQty = parseInt(confirmForm.finishedQty) || 1;
    const finImg = confirmForm.finishedImg;
    setAiComparing(true);
    const comparison = req.refImg && finImg ? await runAIComparison(req, finImg) : null;
    setAiComparing(false);
    if (comparison) setAiCompResult(comparison);

    const invId = "I-PROD-" + req.id;
    setInventory(prev => [...prev, {
      id: invId, name: req.name, cat: deptToCategory(req.dept),
      type: "Budgeted", itemClass: "discrete", qty: finQty, unit: "Piece",
      loc: "Production/New", price: 0, cost: 0, breakagePct: 5, blocked: 0,
      img: finImg || "", notes: req.description + " [Production build]",
      source: "production", buildType: req.buildType, productionId: req.id,
    }]);
    setProdRequests(prev => prev.map(r => r.id === req.id ? {
      ...r, status: "Added to Inventory", finishedImg: finImg, finishedQty: finQty,
      aiComparison: comparison, confirmedBy: "Production Team",
      confirmedDate: new Date().toISOString().split("T")[0], inventoryId: invId,
    } : r));
    setConfirmModal(null);
    setConfirmForm({ finishedImg: null, finishedQty: 1, notes: "" });
    setAiCompResult(null);
  }

  // ── Purchase from Production ──────────────────────────────────────────────
  function openPurchaseModal(reqId) {
    setPurchaseModal(reqId);
    setPurchaseMode("partial");
    setMaterialLines([{ name: "", qty: "", unit: "Piece", estimatedCost: "", vendor: "", notes: "" }]);
  }
  function addMaterialLine() { setMaterialLines(p => [...p, { name: "", qty: "", unit: "Piece", estimatedCost: "", vendor: "", notes: "" }]); }
  function updateMaterialLine(i, k, v) { setMaterialLines(p => p.map((l, j) => j === i ? { ...l, [k]: v } : l)); }
  function removeMaterialLine(i) { setMaterialLines(p => p.filter((_, j) => j !== i)); }

  function submitPurchaseRequests() {
    if (!setPurchase || !purchaseModal) return;
    const req = prodRequests.find(r => r.id === purchaseModal);
    if (!req) return;
    const today = new Date().toISOString().split("T")[0];
    const fn = functions.find(f => f.id === req.functionId);

    if (purchaseMode === "full") {
      // Send entire production item to purchase department
      const prNum = String(Date.now()).slice(-6);
      setPurchase(prev => [...prev, {
        id: "PR-PROD-" + prNum, poNumber: "PO-PROD-" + prNum,
        item: req.name, qty: req.qty, unit: "Piece", cat: deptToCategory(req.dept),
        reason: `Full production item outsourced — ${req.description || req.name}`,
        requestedBy: req.raisedBy || "Production Head", requestedByRole: "Production",
        date: today, estimatedCost: parseFloat(materialLines[0]?.estimatedCost) || 0,
        vendor: materialLines[0]?.vendor || "", notes: `Linked to ${req.id} · ${fn ? fn.name + " " + fn.date : ""}`,
        requestType: "production_full", buildTaskId: req.id,
        status: "Pending", adminApproval: null, actualCost: null, actualQty: null,
        approvedBy: null, approvedDate: null, vendorSnapshot: null,
        functionAllocation: req.functionId ? { functionId: req.functionId, amount40pct: 0 } : null,
        centralAllocation: null,
      }]);
      // Update prod request status
      setProdRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "Requested", notes: (r.notes || "") + " [Sent to Purchase Dept — Full]", purchaseRaised: "full" } : r));
    } else {
      // Partial materials
      const validLines = materialLines.filter(l => l.name.trim());
      if (validLines.length === 0) return;
      const newPRs = validLines.map((line, idx) => {
        const prNum = String(Date.now() + idx).slice(-6);
        return {
          id: "PR-MAT-" + prNum, poNumber: "PO-MAT-" + prNum,
          item: line.name, qty: parseFloat(line.qty) || 1, unit: line.unit || "Piece",
          cat: deptToCategory(req.dept),
          reason: `Material for production: ${req.name} (${req.id})`,
          requestedBy: "Production Head", requestedByRole: "Production",
          date: today, estimatedCost: parseFloat(line.estimatedCost) || 0,
          vendor: line.vendor || "", notes: line.notes || `Material for building ${req.name} · ${fn ? fn.name : ""}`,
          requestType: "production_material", buildTaskId: req.id,
          status: "Pending", adminApproval: null, actualCost: null, actualQty: null,
          approvedBy: null, approvedDate: null, vendorSnapshot: null,
          functionAllocation: req.functionId ? { functionId: req.functionId, amount40pct: 0 } : null,
          centralAllocation: null,
        };
      });
      setPurchase(prev => [...prev, ...newPRs]);
      setProdRequests(prev => prev.map(r => r.id === req.id ? {
        ...r, notes: (r.notes || "") + ` [${validLines.length} material PRs raised]`,
        purchaseRaised: "partial", materialPRCount: (r.materialPRCount || 0) + validLines.length,
      } : r));
    }
    setPurchaseModal(null);
  }

  const purchaseReq = prodRequests.find(r => r.id === purchaseModal);

  const confirmReq = prodRequests.find(r => r.id === confirmModal);

  const BOARD_COLS = PROD_STATUSES.filter(s => s !== "Added to Inventory");
  const COL_STYLE = {
    "Requested": { ring: "border-gray-300", bg: "bg-gray-50", dot: "bg-gray-400" },
    "Acknowledged": { ring: "border-blue-300", bg: "bg-blue-50", dot: "bg-blue-500" },
    "In Progress": { ring: "border-amber-300", bg: "bg-amber-50", dot: "bg-amber-500" },
    "Ready for Review": { ring: "border-violet-300", bg: "bg-violet-50", dot: "bg-violet-500" },
    "Confirmed": { ring: "border-green-300", bg: "bg-green-50", dot: "bg-green-500" },
  };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Tabs tabs={[{ id: "board", label: "📋 Requests Board" }, { id: "confirm", label: "📸 Confirm & Add" }, { id: "history", label: "📊 History" }]}
          active={subTab} onChange={setSubTab} />
        {subTab === "board" && (
          <button onClick={() => { setForm(blankForm()); setNewModal(true); }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + New Request
          </button>
        )}
      </div>

      {/* Dept filter pills */}
      <div className="flex flex-wrap gap-2">
        {["All", ...PROD_DEPTS].map(d => (
          <button key={d} onClick={() => setDeptFilter(d)}
            className={"px-3 py-1 rounded-full text-xs font-medium transition-all " + (deptFilter === d ? "bg-indigo-600 text-white" : "bg-white border text-gray-600 hover:border-indigo-300 hover:text-indigo-600")}>
            {d} {d !== "All" && <span className="opacity-60">({prodRequests.filter(r => r.dept === d && r.status !== "Added to Inventory").length})</span>}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* BOARD TAB — Kanban                                                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {subTab === "board" && (
        <div className="overflow-x-auto pb-4 -mx-1 px-1">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {BOARD_COLS.map(status => {
              const cards = byStatus[status] || [];
              const cs = COL_STYLE[status] || { ring: "border-gray-200", bg: "bg-gray-50", dot: "bg-gray-300" };
              const isOver = dragOver === status;
              return (
                <div key={status} style={{ width: "272px" }}
                  className={`rounded-2xl border-2 flex flex-col transition-all ${cs.ring} ${cs.bg} ${isOver ? "ring-2 ring-indigo-400 ring-offset-1" : ""}`}
                  onDragOver={e => onDragOver(e, status)} onDragLeave={onDragLeave} onDrop={e => onDrop(e, status)}>
                  {/* Column header */}
                  <div className="px-3 py-2.5 border-b border-white/70 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${cs.dot}`}></div>
                      <p className="font-bold text-sm text-gray-800">{status}</p>
                    </div>
                    <span className="text-xs bg-white/80 text-gray-500 px-2 py-0.5 rounded-full font-semibold">{cards.length}</span>
                  </div>
                  {/* Cards */}
                  <div className="p-2.5 flex-1 space-y-2.5" style={{ minHeight: "180px" }}>
                    {cards.map(req => {
                      const fn = functions.find(f => f.id === req.functionId);
                      const proj = projects.find(p => p.id === req.projectId);
                      const daysLeft = fn ? Math.ceil((new Date(fn.date) - new Date()) / (86400000)) : null;
                      return (
                        <div key={req.id} draggable onDragStart={e => onDragStart(e, req.id)}
                          className={"bg-white rounded-xl border shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing select-none " + (dragId === req.id ? "opacity-40 scale-95" : "")}>
                          {/* Reference image */}
                          {req.refImg
                            ? <img src={req.refImg} alt="" className="w-full h-20 object-cover rounded-t-xl border-b cursor-pointer hover:opacity-90 transition-opacity" onClick={e => { e.stopPropagation(); const slides = fn?.designFile?.extractedSlides; setViewImg(slides && slides.length > 1 ? { title: req.name + " — Design Slides", slides, idx: 0 } : { src: req.refImg, title: req.name + " — Reference" }); }} />
                            : <div className="w-full h-12 rounded-t-xl bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-center justify-center text-gray-300 text-xs">No reference image</div>
                          }
                          <div className="p-3">
                            <p className="font-bold text-gray-900 text-sm leading-tight">{req.name}</p>
                            {req.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{req.description}</p>}
                            {/* Dimensions */}
                            {(req.dimensions.l || req.dimensions.w || req.dimensions.h) && (
                              <p className="text-xs text-indigo-600 font-medium mt-1">
                                📐 {[req.dimensions.l, req.dimensions.w, req.dimensions.h].filter(Boolean).join(" × ")} {req.dimensions.unit}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1 mt-2">
                              <Badge color="indigo">×{req.qty}</Badge>
                              <Badge color={req.buildType === "function" ? "blue" : "green"}>{req.buildType === "function" ? "Function" : "Stock"}</Badge>
                              <Badge color="gray">{req.dept}</Badge>
                            </div>
                            {fn && (
                              <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                                📅 {fn.name} · {fn.date}
                                {daysLeft !== null && <span className={"font-bold " + (daysLeft < 3 ? "text-red-600" : daysLeft < 7 ? "text-amber-500" : "text-green-600")}>
                                  {daysLeft > 0 ? ` (${daysLeft}d)` : " Today!"}
                                </span>}
                              </p>
                            )}
                            {proj && <p className="text-xs text-gray-400 truncate">{proj.name}</p>}
                            {/* Status dropdown */}
                            <select value={req.status} onChange={e => updateStatus(req.id, e.target.value)}
                              onClick={e => e.stopPropagation()}
                              className="mt-2 w-full border rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:bg-gray-100 cursor-pointer">
                              {PROD_STATUSES.map(s => <option key={s}>{s}</option>)}
                            </select>
                            {/* Purchase button */}
                            {req.status !== "Added to Inventory" && setPurchase && (
                              <button onClick={e => { e.stopPropagation(); openPurchaseModal(req.id); }}
                                className={"mt-1.5 w-full text-xs py-1.5 rounded-lg font-medium transition-all " + (req.purchaseRaised ? "bg-green-50 border border-green-200 text-green-700" : "bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100")}>
                                {req.purchaseRaised ? "✅ PR Raised" + (req.materialPRCount ? ` (${req.materialPRCount} items)` : "") : "🛒 Raise Purchase"}
                              </button>
                            )}
                            <p className="text-xs text-gray-400 mt-1">↑ {req.raisedBy} · {req.raisedDate}</p>
                          </div>
                        </div>
                      );
                    })}
                    {cards.length === 0 && (
                      <div className={"rounded-xl border-2 border-dashed py-6 text-center transition-colors " + (isOver ? "border-indigo-400 bg-indigo-50" : "border-gray-200")}>
                        <p className="text-xs text-gray-400">{isOver ? "Drop here" : "Empty"}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* CONFIRM & ADD TAB                                                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {subTab === "confirm" && (
        <div className="space-y-4">
          {filtered.filter(r => r.status === "Ready for Review").length === 0 && (
            <div className="bg-gray-50 border-2 border-dashed rounded-2xl py-16 text-center">
              <p className="text-4xl mb-3">📸</p>
              <p className="text-gray-600 font-medium">No items ready for review{deptFilter !== "All" ? ` in ${deptFilter}` : ""}</p>
              <p className="text-xs text-gray-400 mt-1">When a card is moved to "Ready for Review", it appears here</p>
            </div>
          )}
          {filtered.filter(r => r.status === "Ready for Review").map(req => {
            const fn = functions.find(f => f.id === req.functionId);
            const proj = projects.find(p => p.id === req.projectId);
            return (
              <div key={req.id} className="bg-white border rounded-2xl p-5 hover:shadow-sm transition-shadow">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 text-center">
                    <p className="text-xs text-gray-400 font-medium mb-1.5">Reference</p>
                    {req.refImg
                      ? <img src={req.refImg} alt="" className="w-28 h-28 rounded-xl object-cover border-2 border-indigo-200 shadow-sm cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setViewImg({ src: req.refImg, title: req.name + " — Reference" })} />
                      : <div className="w-28 h-28 rounded-xl border-2 border-dashed bg-gray-50 flex items-center justify-center text-gray-300 text-xs text-center">No reference</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-gray-900 text-base">{req.name}</p>
                        {req.description && <p className="text-sm text-gray-500 mt-0.5">{req.description}</p>}
                        {(req.dimensions.l || req.dimensions.w) && (
                          <p className="text-xs text-indigo-600 font-medium mt-1">
                            📐 {[req.dimensions.l, req.dimensions.w, req.dimensions.h].filter(Boolean).join(" × ")} {req.dimensions.unit}
                          </p>
                        )}
                        {req.notes && <p className="text-xs text-gray-500 mt-1 italic">📝 {req.notes}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <Badge color="gray">{req.dept}</Badge>
                        {fn && <p className="text-xs text-gray-500 mt-1">{fn.name} · {fn.date}</p>}
                        {proj && <p className="text-xs text-gray-400">{proj.name}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Badge color="indigo">×{req.qty} needed</Badge>
                      <Badge color={req.buildType === "function" ? "blue" : "green"}>{req.buildType === "function" ? "For Function" : "General Stock"}</Badge>
                    </div>
                    <button onClick={() => { setConfirmModal(req.id); setConfirmForm({ finishedImg: null, finishedQty: req.qty, notes: "" }); setAiCompResult(null); }}
                      className="mt-4 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">
                      📸 Upload Finished Photo & Add to Inventory
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* HISTORY TAB                                                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {subTab === "history" && (
        <div className="space-y-3">
          {filtered.filter(r => r.status === "Added to Inventory").length === 0 && (
            <div className="bg-gray-50 border-2 border-dashed rounded-2xl py-16 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-gray-600 font-medium">No completed production items yet</p>
            </div>
          )}
          {filtered.filter(r => r.status === "Added to Inventory").map(req => {
            const fn = functions.find(f => f.id === req.functionId);
            const proj = projects.find(p => p.id === req.projectId);
            const comp = req.aiComparison;
            const compColor = comp?.result === "Match" ? "green" : comp?.result === "Partial" ? "amber" : "red";
            const compIcon = comp?.result === "Match" ? "✅" : comp?.result === "Partial" ? "⚠️" : "❌";
            return (
              <div key={req.id} className="bg-white border rounded-2xl p-4">
                <div className="flex items-start gap-4">
                  {/* Side by side photos */}
                  <div className="flex-shrink-0 flex gap-2">
                    {req.refImg && (
                      <div className="text-center">
                        <p className="text-xs text-gray-400 mb-1">Reference</p>
                        <img src={req.refImg} alt="ref" className="w-20 h-20 rounded-xl object-cover border shadow-sm cursor-pointer hover:opacity-90 transition-opacity" onClick={() => { const slides = fn?.designFile?.extractedSlides; setViewImg(slides && slides.length > 1 ? { title: req.name + " — Design Slides", slides, idx: 0 } : { src: req.refImg, title: req.name + " — Reference" }); }} />
                      </div>
                    )}
                    {req.finishedImg && (
                      <div className="text-center">
                        <p className="text-xs text-gray-400 mb-1">Finished</p>
                        <img src={req.finishedImg} alt="fin" className="w-20 h-20 rounded-xl object-cover border-2 border-green-400 shadow-sm cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setViewImg({ src: req.finishedImg, title: req.name + " — Finished" })} />
                      </div>
                    )}
                    {!req.refImg && !req.finishedImg && (
                      <div className="w-20 h-20 rounded-xl border bg-gray-50 flex items-center justify-center text-gray-300 text-2xl">🏭</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900">{req.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{req.dept} · {req.buildType === "function" ? "For Function" : "General Stock"}</p>
                    {proj && fn && <p className="text-xs text-gray-500">{proj.name} → {fn.name} ({fn.date})</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge color="teal">✅ In Inventory</Badge>
                      <Badge color="indigo">×{req.finishedQty || req.qty} built</Badge>
                      {comp && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium bg-${compColor}-100 text-${compColor}-700`}>
                          {compIcon} {comp.result} — {comp.reason}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">Confirmed by {req.confirmedBy} · {req.confirmedDate}</p>
                    {req.inventoryId && <p className="text-xs text-indigo-600 mt-0.5">📦 Inventory ID: {req.inventoryId}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* NEW REQUEST MODAL                                                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Modal open={newModal} onClose={() => { setNewModal(false); setForm(blankForm()); }} title="🏭 New Production Request" wide>
        <div className="grid grid-cols-2 gap-3">
          {/* Item Name */}
          <div className="col-span-2">
            <label className="text-xs text-gray-500">Item Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Floral Arch 10ft" />
          </div>
          {/* Description */}
          <div className="col-span-2">
            <label className="text-xs text-gray-500">Description</label>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Materials, style, colour, finishing details..." />
          </div>
          {/* Dimensions */}
          <div className="col-span-2">
            <label className="text-xs text-gray-500">Dimensions (Width × Depth × Height)</label>
            <div className="flex gap-2 mt-1 items-center">
              <input value={form.dimensions.w} onChange={e => setForm({ ...form, dimensions: { ...form.dimensions, w: e.target.value } })}
                className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Width" />
              <span className="text-gray-400 text-lg font-light">×</span>
              <input value={form.dimensions.l} onChange={e => setForm({ ...form, dimensions: { ...form.dimensions, l: e.target.value } })}
                className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Depth" />
              <span className="text-gray-400 text-lg font-light">×</span>
              <input value={form.dimensions.h} onChange={e => setForm({ ...form, dimensions: { ...form.dimensions, h: e.target.value } })}
                className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Height" />
              <select value={form.dimensions.unit} onChange={e => setForm({ ...form, dimensions: { ...form.dimensions, unit: e.target.value } })}
                className="border rounded-lg px-2 py-2 text-sm bg-white w-24 flex-shrink-0">
                {DIM_UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {/* Qty + Dept */}
          <div>
            <label className="text-xs text-gray-500">Quantity Needed</label>
            <input type="number" min="1" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Department</label>
            <select value={form.dept} onChange={e => setForm({ ...form, dept: e.target.value })}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
              {PROD_DEPTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          {/* Project + Function */}
          <div>
            <label className="text-xs text-gray-500">Linked Project</label>
            <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value, functionId: "" })}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Select project...</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Linked Function</label>
            <select value={form.functionId} onChange={e => setForm({ ...form, functionId: e.target.value })}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Select function...</option>
              {fnOptions.map(f => <option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
            </select>
          </div>
          {/* Build type */}
          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-2">Build Type</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["function", "🎯 For Specific Function", "40% cost to function, 60% procurement · no rental on first use"],
                ["stock", "📦 For General Stock", "100% cost to procurement · rental applies from first use"],
              ].map(([v, l, desc]) => (
                <label key={v} className={"cursor-pointer border-2 rounded-xl p-3 transition-all " + (form.buildType === v ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-200 bg-white")}>
                  <input type="radio" value={v} checked={form.buildType === v} onChange={() => setForm({ ...form, buildType: v })} className="hidden" />
                  <p className="text-sm font-semibold text-gray-800">{l}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
                </label>
              ))}
            </div>
          </div>
          {/* Reference picture */}
          <div className="col-span-2">
            <label className="text-xs text-gray-500">Reference Picture</label>
            <div className="mt-1 flex items-center gap-4">
              {form.refImg
                ? <div className="relative">
                    <img src={form.refImg} alt="ref" className="w-24 h-24 rounded-xl object-cover border-2 border-indigo-300" />
                    <button onClick={() => setForm({ ...form, refImg: null })}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center shadow">×</button>
                  </div>
                : <label className="cursor-pointer w-24 h-24 border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-indigo-500 transition-colors">
                    <span className="text-2xl">📎</span>
                    <span className="text-xs">Add ref pic</span>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setForm(fm => ({ ...fm, refImg: ev.target.result })); r.readAsDataURL(f); }} />
                  </label>
              }
              <p className="text-xs text-gray-400 leading-relaxed">Upload a reference image from the design brief, PPT slide or client mood board. Production team will build to match this.</p>
            </div>
          </div>
          {/* Notes */}
          <div className="col-span-2">
            <label className="text-xs text-gray-500">Notes / Special Instructions</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Special materials, colour codes, finishing, priority..." />
          </div>
        </div>
        <button onClick={createRequest} disabled={!form.name.trim()}
          className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg py-3 text-sm font-bold">
          🏭 Raise Production Request
        </button>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* CONFIRM & ADD TO INVENTORY MODAL                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Modal open={!!confirmModal} onClose={() => { setConfirmModal(null); setAiCompResult(null); setConfirmForm({ finishedImg: null, finishedQty: 1, notes: "" }); }} title="📸 Confirm & Add to Inventory" wide>
        {confirmReq && (
          <div className="space-y-4">
            {/* Two-photo comparison layout */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">📌 Reference Picture</p>
                {confirmReq.refImg
                  ? <img src={confirmReq.refImg} alt="ref" className="w-full h-44 object-cover rounded-2xl border-2 border-indigo-200 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => { const cfn = functions.find(f => f.id === confirmReq.functionId); const slides = cfn?.designFile?.extractedSlides; setViewImg(slides && slides.length > 1 ? { title: confirmReq.name + " — Design Slides", slides, idx: 0 } : { src: confirmReq.refImg, title: confirmReq.name + " — Reference" }); }} />
                  : <div className="w-full h-44 rounded-2xl border-2 border-dashed bg-gray-50 flex items-center justify-center text-gray-300 text-sm">No reference image</div>
                }
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">📸 Finished Item Photo <span className="text-red-400">*</span></p>
                {confirmForm.finishedImg
                  ? <div className="relative">
                      <img src={confirmForm.finishedImg} alt="fin" className="w-full h-44 object-cover rounded-2xl border-2 border-green-400 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setViewImg({ src: confirmForm.finishedImg, title: confirmReq.name + " — Finished" })} />
                      <button onClick={() => { setConfirmForm(f => ({ ...f, finishedImg: null })); setAiCompResult(null); }}
                        className="absolute top-2 right-2 w-7 h-7 bg-red-500 rounded-full text-white text-xs flex items-center justify-center shadow-lg">×</button>
                    </div>
                  : <label className="cursor-pointer w-full h-44 rounded-2xl border-2 border-dashed border-green-300 hover:border-green-500 bg-green-50 hover:bg-green-100 flex flex-col items-center justify-center gap-2 text-green-500 hover:text-green-700 transition-all">
                      <span className="text-5xl">📷</span>
                      <span className="text-sm font-semibold">Click to take / upload photo</span>
                      <span className="text-xs text-green-400">AI will compare against reference</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={async e => {
                          const file = e.target.files[0]; if (!file) return;
                          const r = new FileReader();
                          r.onload = async ev => {
                            const d = ev.target.result;
                            setConfirmForm(f => ({ ...f, finishedImg: d }));
                            if (confirmReq.refImg) {
                              setAiComparing(true);
                              const comp = await runAIComparison(confirmReq, d);
                              setAiCompResult(comp);
                              setAiComparing(false);
                            }
                          };
                          r.readAsDataURL(file);
                        }} />
                    </label>
                }
              </div>
            </div>

            {/* AI comparison result */}
            {aiComparing && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-center">
                <p className="text-sm font-semibold text-violet-700 animate-pulse">🤖 AI comparing reference vs finished photo...</p>
              </div>
            )}
            {aiCompResult && !aiComparing && (
              <div className={`border rounded-xl p-4 flex items-center gap-3 ${aiCompResult.result === "Match" ? "bg-green-50 border-green-200" : aiCompResult.result === "Partial" ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
                <span className="text-3xl flex-shrink-0">{aiCompResult.result === "Match" ? "✅" : aiCompResult.result === "Partial" ? "⚠️" : "❌"}</span>
                <div>
                  <p className={`font-bold text-sm ${aiCompResult.result === "Match" ? "text-green-800" : aiCompResult.result === "Partial" ? "text-amber-800" : "text-red-800"}`}>
                    {aiCompResult.result}
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5">{aiCompResult.reason}</p>
                  <p className="text-xs text-gray-400 mt-1">AI photo comparison result — stored with this production record</p>
                </div>
              </div>
            )}

            {/* Actual qty + notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-orange-600">Actual Qty Built *</label>
                <input type="number" min="1" value={confirmForm.finishedQty}
                  onChange={e => setConfirmForm({ ...confirmForm, finishedQty: e.target.value })}
                  className="mt-1 w-full border-2 border-orange-300 focus:border-orange-500 rounded-lg px-3 py-2 text-sm font-bold outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Confirmation Notes</label>
                <input value={confirmForm.notes} onChange={e => setConfirmForm({ ...confirmForm, notes: e.target.value })}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Any remarks about the build..." />
              </div>
            </div>

            {/* What will happen summary */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
              <p className="text-xs font-bold text-indigo-800 mb-1">What happens when you confirm:</p>
              <p className="text-xs text-indigo-700">✅ New inventory entry created: <strong>{confirmReq.name}</strong> × {confirmForm.finishedQty || confirmReq.qty}</p>
              <p className="text-xs text-indigo-700 mt-0.5">{confirmReq.buildType === "function" ? "💰 Cost split: 40% to linked function · 60% to central procurement · No rental on first use" : "💰 100% cost to central procurement · Rental applies from first use"}</p>
            </div>

            <button onClick={() => confirmAndAdd(confirmReq)}
              disabled={!confirmForm.finishedImg || aiComparing}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2">
              ✅ Confirm & Add to Inventory
            </button>
          </div>
        )}
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* PURCHASE FROM PRODUCTION MODAL                                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Modal open={!!purchaseModal} onClose={() => setPurchaseModal(null)} title="🛒 Raise Purchase Request" wide>
        {purchaseReq && (
          <div className="space-y-4">
            {/* Production item context */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
              {purchaseReq.refImg && <img src={purchaseReq.refImg} alt="" className="w-16 h-16 rounded-lg object-cover border flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => { const pfn = functions.find(f => f.id === purchaseReq.functionId); const slides = pfn?.designFile?.extractedSlides; setViewImg(slides && slides.length > 1 ? { title: purchaseReq.name + " — Design Slides", slides, idx: 0 } : { src: purchaseReq.refImg, title: purchaseReq.name + " — Reference" }); }} />}
              <div>
                <p className="font-bold text-indigo-900">{purchaseReq.name}</p>
                <p className="text-xs text-indigo-700 mt-0.5">{purchaseReq.description} · ×{purchaseReq.qty} · {purchaseReq.dept}</p>
                {(() => { const fn = functions.find(f => f.id === purchaseReq.functionId); return fn ? <p className="text-xs text-indigo-500 mt-0.5">📅 {fn.name} · {fn.date}</p> : null; })()}
              </div>
            </div>

            {/* Mode selection */}
            <div className="grid grid-cols-2 gap-3">
              {[
                ["full", "🏭 → 🛒 Full Outsource", "Send entire item to Purchase Dept to buy from outside instead of building in-house"],
                ["partial", "🔧 Partial Materials", "Request specific raw materials / components needed to build this item"],
              ].map(([mode, label, desc]) => (
                <button key={mode} onClick={() => setPurchaseMode(mode)}
                  className={"border-2 rounded-xl p-4 text-left transition-all " + (purchaseMode === mode ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-300")}>
                  <p className={"text-sm font-bold " + (purchaseMode === mode ? "text-indigo-800" : "text-gray-700")}>{label}</p>
                  <p className="text-xs text-gray-500 mt-1">{desc}</p>
                </button>
              ))}
            </div>

            {/* Full outsource — simple cost + vendor */}
            {purchaseMode === "full" && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-bold text-amber-800">Full item will be sent to Purchase Department</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Estimated Cost ₹</label>
                    <input type="number" value={materialLines[0]?.estimatedCost || ""} onChange={e => updateMaterialLine(0, "estimatedCost", e.target.value)}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 25000" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Suggested Vendor</label>
                    <input value={materialLines[0]?.vendor || ""} onChange={e => updateMaterialLine(0, "vendor", e.target.value)}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Delhi Fabricators" />
                  </div>
                </div>
                <div className="bg-white border border-amber-100 rounded-lg p-3 text-xs text-amber-700">
                  💡 This will create a Purchase Request for <strong>{purchaseReq.name} ×{purchaseReq.qty}</strong> and mark the production task accordingly.
                </div>
              </div>
            )}

            {/* Partial materials — multi-line */}
            {purchaseMode === "partial" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-800">🔧 Materials / Components Needed</p>
                  <button onClick={addMaterialLine} className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1.5 rounded-lg font-medium">+ Add Material</button>
                </div>
                {materialLines.map((line, i) => (
                  <div key={i} className="bg-white border rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-400">Material #{i + 1}</span>
                      {materialLines.length > 1 && <button onClick={() => removeMaterialLine(i)} className="text-xs text-red-400 hover:text-red-600">✕ Remove</button>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <input value={line.name} onChange={e => updateMaterialLine(i, "name", e.target.value)}
                          className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Material name e.g. Steel pipe 2 inch" />
                      </div>
                      <div className="flex gap-2">
                        <input type="number" value={line.qty} onChange={e => updateMaterialLine(i, "qty", e.target.value)}
                          className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Qty" />
                        <select value={line.unit} onChange={e => updateMaterialLine(i, "unit", e.target.value)}
                          className="border rounded-lg px-2 py-2 text-sm bg-white w-24">
                          {["Piece", "Kg", "Metre", "Roll", "Set", "Litre", "Bundle", "Sq ft", "Box"].map(u => <option key={u}>{u}</option>)}
                        </select>
                      </div>
                      <input type="number" value={line.estimatedCost} onChange={e => updateMaterialLine(i, "estimatedCost", e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm" placeholder="Est. cost per unit ₹" />
                      <input value={line.vendor} onChange={e => updateMaterialLine(i, "vendor", e.target.value)}
                        className="border rounded-lg px-3 py-2 text-sm" placeholder="Vendor (optional)" />
                      <input value={line.notes} onChange={e => updateMaterialLine(i, "notes", e.target.value)}
                        className="col-span-2 border rounded-lg px-3 py-2 text-sm" placeholder="Notes e.g. galvanized, food-grade" />
                    </div>
                  </div>
                ))}
                {materialLines.filter(l => l.name.trim()).length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
                    ✅ {materialLines.filter(l => l.name.trim()).length} material{materialLines.filter(l => l.name.trim()).length > 1 ? "s" : ""} will be sent as separate Purchase Requests linked to <strong>{purchaseReq.name}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Submit */}
            <button onClick={submitPurchaseRequests}
              disabled={purchaseMode === "partial" && materialLines.filter(l => l.name.trim()).length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-bold">
              🛒 {purchaseMode === "full" ? "Send to Purchase Department" : `Raise ${materialLines.filter(l => l.name.trim()).length} Purchase Request${materialLines.filter(l => l.name.trim()).length > 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* IMAGE LIGHTBOX — Full-screen viewer with slide navigation            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {viewImg && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setViewImg(null)}>
          {/* Close button */}
          <button onClick={() => setViewImg(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white text-xl flex items-center justify-center backdrop-blur-sm transition-all z-10">×</button>
          {/* Title */}
          <div className="absolute top-4 left-4 z-10">
            <p className="text-white font-bold text-sm bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-lg">{viewImg.title}</p>
            {viewImg.slides && viewImg.slides.length > 1 && (
              <p className="text-white/70 text-xs mt-1 bg-black/30 backdrop-blur-sm px-3 py-1 rounded-lg">Slide {(viewImg.idx || 0) + 1} of {viewImg.slides.length} · Use ← → arrows</p>
            )}
          </div>
          {/* Main image */}
          <img src={viewImg.slides ? viewImg.slides[viewImg.idx || 0] : viewImg.src} alt=""
            className="max-w-[90vw] max-h-[85vh] rounded-xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()} />
          {/* Prev/Next arrows for multi-slide */}
          {viewImg.slides && viewImg.slides.length > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); setViewImg(v => ({ ...v, idx: ((v.idx || 0) - 1 + v.slides.length) % v.slides.length })); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 hover:bg-white/40 text-white text-2xl flex items-center justify-center backdrop-blur-sm transition-all">‹</button>
              <button onClick={e => { e.stopPropagation(); setViewImg(v => ({ ...v, idx: ((v.idx || 0) + 1) % v.slides.length })); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 hover:bg-white/40 text-white text-2xl flex items-center justify-center backdrop-blur-sm transition-all">›</button>
            </>
          )}
          {/* Slide thumbnails strip */}
          {viewImg.slides && viewImg.slides.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 bg-black/40 backdrop-blur-sm px-3 py-2 rounded-xl">
              {viewImg.slides.map((sl, i) => (
                <img key={i} src={sl} alt="" onClick={e => { e.stopPropagation(); setViewImg(v => ({ ...v, idx: i })); }}
                  className={"w-14 h-10 rounded-lg object-cover border-2 cursor-pointer transition-all " + ((viewImg.idx || 0) === i ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-90")} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
