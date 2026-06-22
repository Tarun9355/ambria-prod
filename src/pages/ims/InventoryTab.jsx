import React, { useState, useRef } from "react";
import { Badge, TypeBadge, Modal } from "../../components/ui";
import { fmt } from "../../lib/format";
import { INV_CATS, INV_LOCATIONS, DEPTS, INV_TYPES, PRICING_CAT_STYLES, SUBCAT_OTHER } from "../../lib/inventory/constants";
import { findAlternatives, getEffectivePricing } from "../../lib/inventory/helpers";
import { IMS_CLD_PRESET, IMS_CLD_UPLOAD_URL, compressImageForCloudinary } from "../../lib/cloudinary";
import { callClaudeStreaming } from "../../lib/ai";
import { locationBreakdown } from "../../lib/ims/fixedVenues";

export default function InventoryTab({ inventory, setInventory, functions, setFunctions, categories, setCategories, settings, studio }) {
  // Studio sub-categories (Tier 1.1 source of truth · flat list · empty during boot)
  const studioSubcats = studio?.subcats || [];
  const studioLoading = !!studio?.loading;
  // Tier 1.2 — Studio cat labels + scoped subcat lookup
  const studioCatLabels = studio?.catLabels || [];
  const studioSubcatsByCat = studio?.subcatsByCat || {};
  // Returns subcats for a given cat label, falling back to flat list for legacy/ambiguous cats
  const subcatsForCat = (catLabel) => {
    const scoped = studioSubcatsByCat[catLabel];
    return (scoped && scoped.length > 0) ? scoped : studioSubcats;
  };
  // Legacy cat names that still need migration — used to highlight items in UI
  const isLegacyCat = (cat) => cat === "Stage" || cat === "Structural" || cat === "Consumable" || cat === "Floral" || cat === "Lighting" || cat === "Furniture" || cat === "Fabric" || cat === "Props";
  const [subOtherAdd, setSubOtherAdd] = useState(false); // Add modal "Other" mode
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterSubCat, setFilterSubCat] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const [filterNeedsReview, setFilterNeedsReview] = useState(false); // Tier 1.2 — show only items flagged for cat-migration review
  const [invPage, setInvPage] = useState(0);
  const INV_PAGE_SIZE = 30;
  const [detailItem, setDetailItem] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [blockModal, setBlockModal] = useState(null);
  const [bulkModal, setBulkModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [blockForm, setBlockForm] = useState({ fnId: "", qty: 1, dept: "Flower", remark: "", sizeClass: "M" });
  // Bulk block state
  const [bulkFnId, setBulkFnId] = useState("");
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkSel, setBulkSel] = useState({}); // {invId: {qty, dept, remark}}
  // Excel import state
  const [importStep, setImportStep] = useState(1);
  const [importRows, setImportRows] = useState([]);
  const [importMap, setImportMap] = useState({});
  const [importChecked, setImportChecked] = useState({});
  const [importMode, setImportMode] = useState("both");
  const [importDone, setImportDone] = useState({ added: 0, updated: 0, skipped: 0 });

  const [form, setForm] = useState({ name: "", cat: "Florals", subCat: "", type: "Budgeted", itemClass: "discrete", qty: "", unit: "Piece", loc: "", price: "", cost: "", breakagePct: 0, notes: "", img: "" });
  const voiceRef = useRef(null);
  const [listening, setListening] = useState(false);

  // ── Edit Item state ──────────────────────────────────────────────────────
  const [editModal, setEditModal] = useState(null); // item id being edited, or null
  const [editForm, setEditForm] = useState({});
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);
  const editPhotoInputRef = useRef(null);

  // ── Photo Scan state ──────────────────────────────────────────────────────
  const [photoModal, setPhotoModal] = useState(false);
  const [photoImg, setPhotoImg] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoReady, setPhotoReady] = useState(false);
  const photoInputRef = useRef(null);

  function openPhotoScan() {
    setPhotoImg(null); setPhotoError(""); setPhotoReady(false);
    setForm({ name: "", cat: "Florals", subCat: "", type: "Budgeted", itemClass: "discrete", qty: "1", unit: "Piece", loc: "", price: "", cost: "", breakagePct: 0, notes: "", img: "" });
    setPhotoModal(true);
    setTimeout(() => photoInputRef.current?.click(), 200);
  }

  function handlePhotoCapture(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      setPhotoImg(dataUrl);
      setForm((f) => ({ ...f, img: dataUrl }));
      await runPhotoAI(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function runPhotoAI(dataUrl) {
    setPhotoLoading(true); setPhotoError(""); setPhotoReady(false);
    try {
      const mediaType = dataUrl.split(";")[0].split(":")[1];
      const base64 = dataUrl.split(",")[1];
      const catList = (studioCatLabels.length > 0 ? studioCatLabels : INV_CATS).join(", ");
      const photoBlocks = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: `You are helping a godown team at an event decoration company log inventory by photo.

SUB-CATEGORIES (pick one, exact match):
${studioSubcats.join(", ")}

Look at this photo and identify the decoration/inventory item. Return ONLY JSON (no markdown, no explanation):
{
  "name": "specific item name e.g. Rose Arch Large or Crystal Chandelier or Silk Drape Set",
  "cat": "one of: ${catList}",
  "subCat": "matching sub-category from the structure above",
  "type": "Budgeted or Premium",
  "itemClass": "discrete or bulk",
  "unit": "Piece or Set or Kg or Metre or Bundle or Roll",
  "qty": 1,
  "loc": "",
  "price": 0,
  "cost": 0,
  "breakagePct": 5,
  "notes": "colour, size, condition observed",
  "confidence": "High or Medium or Low"
}
Rules:
- name: specific — include size/colour if visible
- cat: pick the closest match from the cat list above based on what the item physically is
- subCat: pick the most specific sub-category from the structure above that matches
- type: Premium if expensive/delicate, else Budgeted
- itemClass: discrete if countable (1 arch), bulk if by weight/length (kg roses, metres ribbon)
- confidence: Low if unclear` },
      ];
      const text = await callClaudeStreaming({ contentBlocks: photoBlocks, model: "claude-sonnet-4-6", maxTokens: 600 });
      const clean = text.replace(/```json|```/g, "").trim();
      const ai = JSON.parse(clean);
      const validCats = studioCatLabels.length > 0 ? studioCatLabels : INV_CATS;
      setForm((f) => ({
        ...f,
        name: ai.name || f.name,
        cat: validCats.includes(ai.cat) ? ai.cat : (validCats[0] || "Florals"),
        subCat: ai.subCat || "",
        type: ["Budgeted", "Premium", "In-house"].includes(ai.type) ? ai.type : "Budgeted",
        itemClass: ai.itemClass === "bulk" ? "bulk" : "discrete",
        unit: ai.unit || "Piece",
        qty: String(ai.qty || 1),
        loc: ai.loc || "",
        price: String(ai.price || ""),
        cost: String(ai.cost || ""),
        breakagePct: ai.breakagePct || 5,
        notes: ai.notes || "",
        img: f.img,
        _aiConfidence: ai.confidence || "Medium",
      }));
      setPhotoReady(true);
    } catch (err) {
      setPhotoError("AI could not read the photo: " + err.message + ". Please fill in details manually.");
      setPhotoReady(true);
    }
    setPhotoLoading(false);
  }

  // Tier 1.2 — sub-cat options scoped to the selected filter cat (falls back to flat list when "All" or unknown)
  const subCatOptions = (filterCat === "All" || !studioSubcatsByCat[filterCat]) ? studioSubcats : studioSubcatsByCat[filterCat];
  const needsReviewCount = inventory.filter((i) => i?._needsCatMigration).length;
  const filtered = inventory.filter((i) => {
    const q = search.toLowerCase();
    const matchSearch = !q || i.name.toLowerCase().includes(q) || i.cat.toLowerCase().includes(q) || (i.subCat || "").toLowerCase().includes(q) || (i.code || "").toLowerCase().includes(q);
    const matchCat = filterCat === "All" || i.cat === filterCat;
    const matchSubCat = filterSubCat === "All" || !filterSubCat || (i.subCat || "") === filterSubCat;
    const matchType = filterType === "All" || i.type === filterType;
    const matchReview = !filterNeedsReview || i?._needsCatMigration;
    return matchSearch && matchCat && matchType && matchSubCat && matchReview;
  });
  const totalPages = Math.ceil(filtered.length / INV_PAGE_SIZE);
  const safePage = Math.min(invPage, Math.max(0, totalPages - 1));
  const paged = filtered.slice(safePage * INV_PAGE_SIZE, (safePage + 1) * INV_PAGE_SIZE);

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR(); r.lang = "en-IN"; r.continuous = false;
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onresult = (e) => setForm((f) => ({ ...f, name: e.results[0][0].transcript }));
    r.start(); voiceRef.current = r;
  }

  function handleImg(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setForm((f) => ({ ...f, img: ev.target.result }));
    reader.readAsDataURL(file);
  }

  async function addItem() {
    const id = "I" + String(inventory.length + 10).padStart(3, "0");
    let img = form.img || "";
    // Upload base64 to Cloudinary instead of storing raw (prevents 413 payload-too-large)
    if (img && img.startsWith("data:")) {
      try {
        const fd = new FormData();
        fd.append("file", img);
        fd.append("upload_preset", IMS_CLD_PRESET);
        fd.append("folder", "inventory");
        const res = await fetch(IMS_CLD_UPLOAD_URL, { method: "POST", body: fd });
        const data = await res.json();
        if (data.secure_url) { img = data.secure_url; }
        else { console.warn("[addItem] Cloudinary upload failed, stripping photo"); img = ""; }
      } catch (err) { console.warn("[addItem] photo upload error:", err); img = ""; }
    }
    const dims_LxWxH = (form.dimL || form.dimW || form.dimH) ? { l: form.dimL || "", w: form.dimW || "", h: form.dimH || "", unit: form.dimUnit || "Feet" } : null;
    const printable_LxW = (form.printL || form.printW) ? { l: form.printL || "", w: form.printW || "", unit: form.printUnit || "Feet" } : null;
    const size = dims_LxWxH ? [form.dimL, form.dimW, form.dimH].filter(Boolean).join(" × ") + " " + (form.dimUnit || "Feet") : "";
    const qtyNum = parseInt(form.qty) || 0;
    const priceNum = parseFloat(form.price) || 0;
    const costNum = parseFloat(form.cost) || 0;
    const breakNum = parseFloat(form.breakagePct) || 0;
    const paintNum = form.paintCost ? (parseFloat(form.paintCost) || 0) : 0;
    const code = form.cat.slice(0, 3).toUpperCase() + "-" + String(inventory.length + 1).padStart(5, "0");
    setInventory([...inventory, {
      id, code, img,
      // Superset schema — write BOTH legacy + new field names (matches saveEdit)
      name: form.name,
      cat: form.cat, category: form.cat,
      subCat: form.subCat, subcategory: form.subCat,
      type: form.type, tier: form.type,
      itemClass: form.itemClass,
      qty: qtyNum, qtyOwned: qtyNum,
      unit: form.unit,
      loc: form.loc, location: form.loc,
      price: priceNum, rentalCost: priceNum,
      cost: costNum,
      breakagePct: breakNum,
      baseColour: form.baseColour || "",
      paintCost: paintNum,
      notes: form.notes || "",
      blocked: 0,
      source: "manual",
      dims_LxWxH, printable_LxW, size,
      photoUrls: img ? [img] : [],
    }]);
    setForm({ name: "", cat: "Florals", subCat: "", type: "Budgeted", itemClass: "discrete", qty: "", unit: "Piece", loc: "Production House", price: "", cost: "", breakagePct: 0, dimL: "", dimW: "", dimH: "", dimUnit: "Feet", printL: "", printW: "", printUnit: "Feet", baseColour: "", paintCost: "", notes: "", img: "" });
    setAddModal(false);
  }

  function deleteItem(id) {
    const it = inventory.find((i) => i.id === id);
    if (!window.confirm(`Delete "${it?.name || "this item"}" from inventory?\n\nThis permanently removes the item and cannot be undone.`)) return;
    setInventory((prev) => prev.filter((i) => i.id !== id), [id]);
  }

  // ── Edit handlers ────────────────────────────────────────────────────────
  function openEdit(itemId) {
    const it = inventory.find((i) => i.id === itemId);
    if (!it) return;
    // Pre-populate form from item, reading BOTH legacy + new spec field names per superset schema
    setEditForm({
      id: it.id,
      name: it.name || "",
      cat: it.cat || it.category || "Floral",
      subCat: it.subCat || it.subcategory || "",
      type: it.type || it.tier || "Budgeted",
      itemClass: it.itemClass || "discrete",
      qty: String(it.qty ?? it.qtyOwned ?? ""),
      unit: it.unit || "Piece",
      loc: it.loc || it.location || "",
      price: String(it.price ?? it.rentalCost ?? ""),
      cost: String(it.cost ?? ""),
      breakagePct: it.breakagePct ?? 0,
      notes: it.notes || "",
      img: it.img || (Array.isArray(it.photoUrls) && it.photoUrls[0]) || "",
      dimL: it.dims_LxWxH?.l ?? "",
      dimW: it.dims_LxWxH?.w ?? "",
      dimH: it.dims_LxWxH?.h ?? "",
      dimUnit: it.dims_LxWxH?.unit || "Feet",
      baseColour: it.baseColour || "",
      paintCost: String(it.paintCost ?? ""),
      printL: it.printable_LxW?.l ?? "",
      printW: it.printable_LxW?.w ?? "",
      printUnit: it.printable_LxW?.unit || "Feet",
      isKit: Array.isArray(it.subItems) && it.subItems.length > 0,
      subItems: Array.isArray(it.subItems) ? it.subItems.map((s) => ({ itemId: s.itemId, qty: Number(s.qty) || 1 })) : [],
    });
    setEditModal(itemId);
    setDetailItem(null); // close detail modal if it was open
  }

  async function handleEditPhoto(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setEditPhotoUploading(true);
    try {
      const compressed = await compressImageForCloudinary(file);
      const fd = new FormData();
      fd.append("file", compressed);
      fd.append("upload_preset", IMS_CLD_PRESET);
      fd.append("folder", "inventory");
      const res = await fetch(IMS_CLD_UPLOAD_URL, { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Cloudinary upload failed");
      if (!data.secure_url) throw new Error("No URL returned");
      setEditForm((f) => ({ ...f, img: data.secure_url }));
    } catch (err) {
      alert("Photo upload failed: " + (err.message || "unknown error"));
    } finally {
      setEditPhotoUploading(false);
      if (editPhotoInputRef.current) editPhotoInputRef.current.value = ""; // allow re-pick of same file
    }
  }

  // §7.9.5 — kit price = Σ(component rental × qty).
  function kitPriceFrom(subItems) {
    if (!Array.isArray(subItems)) return 0;
    return subItems.reduce((sum, si) => {
      const c = inventory.find((i) => i.id === si.itemId);
      const r = c ? (Number(c.price ?? c.rentalCost) || 0) : 0;
      return sum + r * (Number(si.qty) || 0);
    }, 0);
  }

  function saveEdit() {
    const f = editForm;
    if (!f.id) return;
    const lNum = parseFloat(f.dimL), wNum = parseFloat(f.dimW), hNum = parseFloat(f.dimH);
    const hasDims = !isNaN(lNum) || !isNaN(wNum) || !isNaN(hNum);
    const dimsObj = hasDims ? {
      l: isNaN(lNum) ? null : lNum,
      w: isNaN(wNum) ? null : wNum,
      h: isNaN(hNum) ? null : hNum,
      unit: f.dimUnit || "Feet",
    } : null;
    const sizeStr = hasDims
      ? [f.dimL, f.dimW, f.dimH].filter((v) => v !== "" && v !== null && v !== undefined).join(" × ") + (f.dimUnit ? " " + f.dimUnit : "")
      : "";
    const qtyNum = parseInt(f.qty) || 0;
    const isKit = !!f.isKit && Array.isArray(f.subItems) && f.subItems.length > 0;
    const cleanSubItems = isKit ? f.subItems.filter((s) => s.itemId).map((s) => ({ itemId: s.itemId, qty: Number(s.qty) || 1 })) : [];
    // When item is a kit, rental price = auto-summed component cost (overrides manual field)
    const priceNum = isKit ? kitPriceFrom(cleanSubItems) : (parseFloat(f.price) || 0);
    const costNum = parseFloat(f.cost) || 0;
    const breakNum = parseFloat(f.breakagePct) || 0;
    setInventory((prev) => prev.map((i) => {
      if (i.id !== f.id) return i;
      const next = {
        ...i,
        name: f.name,
        cat: f.cat, category: f.cat,
        subCat: f.subCat, subcategory: f.subCat,
        type: f.type, tier: f.type,
        itemClass: f.itemClass,
        qty: qtyNum, qtyOwned: qtyNum,
        unit: f.unit,
        loc: f.loc, location: f.loc || null,
        price: priceNum, rentalCost: priceNum,
        cost: costNum,
        breakagePct: breakNum,
        notes: f.notes,
        img: f.img,
        photoUrls: f.img ? [f.img] : [],
        baseColour: f.baseColour || "",
        paintCost: f.paintCost !== "" && f.paintCost != null ? (parseFloat(f.paintCost) || 0) : (i.paintCost ?? 0),
        subItems: cleanSubItems,
        printable_LxW: (f.printL || f.printW) ? { l: f.printL || "", w: f.printW || "", unit: f.printUnit || "Feet" } : (i.printable_LxW || null),
      };
      if (hasDims) {
        next.dims_LxWxH = dimsObj;
        next.size = sizeStr;
      }
      // Auto-strip flags: any save = approval; price/dims clears the corresponding flag
      if (priceNum > 0 && i._needsPricing) delete next._needsPricing;
      if (hasDims && i._dimUnitMismatch) delete next._dimUnitMismatch;
      if (i._pendingApproval) delete next._pendingApproval;
      const stillLegacy = f.cat === "Stage" || f.cat === "Structural" || f.cat === "Consumable" || f.cat === "Floral" || f.cat === "Lighting" || f.cat === "Furniture" || f.cat === "Fabric" || f.cat === "Props";
      if (!stillLegacy) {
        if (i._needsCatMigration) delete next._needsCatMigration;
        if (i._legacyCat) delete next._legacyCat;
        if (i._catAutoMigrated) delete next._catAutoMigrated;
      }
      return next;
    }));
    setEditModal(null);
    setEditForm({});
  }

  function blockItem() {
    const inv = inventory.find((i) => i.id === blockModal);
    if (!inv || !blockForm.fnId) return;
    const qty = parseInt(blockForm.qty) || 1;
    if (qty > (inv.qty - (inv.blocked || 0))) { alert("Insufficient available qty"); return; }
    const sizeClass = String(blockForm.sizeClass || "M").toUpperCase();
    setInventory((prev) => prev.map((i) => i.id === blockModal ? { ...i, blocked: (i.blocked || 0) + qty } : i));
    setFunctions((prev) => prev.map((f) => f.id === blockForm.fnId ? { ...f, items: [...f.items, { invId: blockModal, qty, dept: blockForm.dept, remark: blockForm.remark, sizeClass }] } : f));
    setBlockModal(null);
    setBlockForm({ fnId: "", qty: 1, dept: "Flower", remark: "", sizeClass: "M" });
  }

  // ── Bulk Block ──────────────────────────────────────────────────────────────
  function toggleBulkItem(id) {
    setBulkSel((prev) => {
      const n = { ...prev };
      if (n[id]) delete n[id];
      else { const inv = inventory.find((i) => i.id === id); n[id] = { qty: 1, dept: "Flower", remark: "", max: inv.qty - (inv.blocked || 0) }; }
      return n;
    });
  }
  function updateBulkItem(id, field, val) { setBulkSel((prev) => ({ ...prev, [id]: { ...prev[id], [field]: val } })); }

  function submitBulk() {
    if (!bulkFnId) return;
    const entries = Object.entries(bulkSel);
    if (!entries.length) return;
    setInventory((prev) => prev.map((i) => {
      const entry = bulkSel[i.id];
      return entry ? { ...i, blocked: (i.blocked || 0) + parseInt(entry.qty || 1) } : i;
    }));
    setFunctions((prev) => prev.map((f) => f.id === bulkFnId ? { ...f, items: [...f.items, ...entries.map(([invId, e]) => ({ invId, qty: parseInt(e.qty || 1), dept: e.dept, remark: e.remark }))] } : f));
    setBulkModal(false); setBulkFnId(""); setBulkSel({}); setBulkSearch("");
  }

  const bulkFiltered = inventory.filter((i) => {
    const avail = i.qty - (i.blocked || 0);
    return avail > 0 && (!bulkSearch || i.name.toLowerCase().includes(bulkSearch.toLowerCase()));
  });

  // ── Excel Import ─────────────────────────────────────────────────────────────
  function handleExcelFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const XLSX = window.XLSX;
        if (!XLSX) { alert("Excel library not loaded yet, try again"); return; }
        const wb = XLSX.read(ev.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        setImportRows(rows);
        // Auto-map columns
        const cols = rows.length ? Object.keys(rows[0]) : [];
        const map = {};
        cols.forEach((c) => {
          const cl = c.toLowerCase();
          if (/name|item|product|description/.test(cl)) map.name = c;
          else if (/category|type|group/.test(cl) && !map.cat) map.cat = c;
          else if (/segment|tier|inventory/.test(cl)) map.type = c;
          else if (/qty|quantity|stock|count/.test(cl)) map.qty = c;
          else if (/unit|uom/.test(cl)) map.unit = c;
          else if (/location|warehouse|godown/.test(cl)) map.loc = c;
          else if (/box|container|carton/.test(cl)) map.boxId = c;
          else if (/note|remark/.test(cl)) map.notes = c;
          else if (/price|rental/.test(cl)) map.price = c;
          else if (/cost|purchase/.test(cl)) map.cost = c;
        });
        setImportMap(map);
        const checked = {};
        rows.forEach((_, i) => { checked[i] = true; });
        setImportChecked(checked);
        setImportStep(2);
      } catch (err) { alert("Error reading file: " + err.message); }
    };
    reader.readAsBinaryString(file);
  }

  function doImport() {
    let added = 0, updated = 0, skipped = 0;
    importRows.forEach((row, i) => {
      if (!importChecked[i]) return;
      const name = String(row[importMap.name] || "").trim();
      if (!name) { skipped++; return; }
      const qty = parseInt(row[importMap.qty] || 0) || 0;
      const existing = inventory.find((inv) => inv.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (importMode === "add") return;
        setInventory((prev) => prev.map((inv) => inv.id === existing.id ? { ...inv, qty: inv.qty + qty } : inv));
        updated++;
      } else {
        if (importMode === "update") return;
        const id = "I" + String(inventory.length + added + 10).padStart(3, "0");
        const newItem = {
          id, name, cat: String(row[importMap.cat] || "Floral"), type: String(row[importMap.type] || "Budgeted"), itemClass: "discrete",
          qty, unit: String(row[importMap.unit] || "Piece"), loc: String(row[importMap.loc] || ""), boxId: String(row[importMap.boxId] || ""),
          notes: String(row[importMap.notes] || ""), price: parseFloat(row[importMap.price] || 0) || 0, cost: parseFloat(row[importMap.cost] || 0) || 0,
          breakagePct: 0, blocked: 0, img: "", source: "import",
        };
        setInventory((prev) => [...prev, newItem]);
        added++;
      }
    });
    setImportDone({ added, updated, skipped });
    setImportStep(4);
  }

  const cats = ["All", ...[...new Set(inventory.map((i) => i.cat))]];
  const selItem = inventory.find((i) => i.id === detailItem);
  const blockInv = inventory.find((i) => i.id === blockModal);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setInvPage(0); }} placeholder="🔍 Search items..." className="border rounded-lg px-3 py-2 text-sm w-48" />
        <select value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setFilterSubCat("All"); setInvPage(0); }} className="border rounded-lg px-3 py-2 text-sm">
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        {needsReviewCount > 0 && (
          <button onClick={() => { setFilterNeedsReview(!filterNeedsReview); setInvPage(0); }}
            className={"px-3 py-1.5 rounded-full text-sm font-medium transition-all border-2 " + (filterNeedsReview ? "bg-amber-500 text-white border-amber-600" : "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100")}>
            🏷️ Needs Review ({needsReviewCount})
          </button>
        )}
        {INV_TYPES.map((t) => (
          <button key={t} onClick={() => { setFilterType(t); setInvPage(0); }}
            className={"px-3 py-1.5 rounded-full text-sm font-medium transition-all " + (filterType === t ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
            {t === "Premium" ? "★ " : t === "In-house" ? "🏠 " : t === "Budgeted" ? "$ " : ""}{t} ({t === "All" ? inventory.length : inventory.filter((i) => i.type === t).length})
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setPhotoModal(false); setBulkModal(false); setImportModal(false); setForm({ name: "", cat: "Florals", subCat: "", type: "Budgeted", itemClass: "discrete", qty: "", unit: "Piece", loc: "Production House", price: "", cost: "", breakagePct: 0, dimL: "", dimW: "", dimH: "", dimUnit: "Feet", printL: "", printW: "", printUnit: "Feet", baseColour: "", paintCost: "", notes: "", img: "" }); setPhotoImg(null); setPhotoReady(false); setPhotoError(""); setAddModal(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm">+ Add Item</button>
        </div>
      </div>

      {/* Sub-Category filter strip */}
      {filterCat !== "All" && subCatOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFilterSubCat("All")}
            className={"px-2.5 py-1 rounded-full text-xs font-medium transition-all " + (filterSubCat === "All" ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200")}>
            All {filterCat}
          </button>
          {subCatOptions.map((sc) => {
            const count = inventory.filter((i) => i.cat === filterCat && i.subCat === sc).length;
            return (
              <button key={sc} onClick={() => setFilterSubCat(sc)}
                className={"px-2.5 py-1 rounded-full text-xs font-medium transition-all " + (filterSubCat === sc ? "bg-violet-600 text-white" : "bg-white text-gray-600 hover:bg-violet-50 border border-gray-200 hover:border-violet-300")}>
                {sc} {count > 0 && <span className="opacity-60">({count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>{["Photo", "Item", "Type", "Category", "Sub-Cat", "Qty", "Avail", "Blkd", "Location", "Price", ""].map((h) => <th key={h} className="px-2.5 py-2 text-left font-medium align-bottom">{h}</th>)}</tr>
          </thead>
          <tbody>
            {paged.map((i) => {
              const avail = i.qty - (i.blocked || 0);
              const zero = avail === 0;
              const low = avail > 0 && avail <= 2;
              return (
                <React.Fragment key={i.id}>
                  <tr className={"border-t cursor-pointer " + (zero ? "bg-red-50 hover:bg-red-100" : low ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50")} onClick={() => setDetailItem(i.id)}>
                    <td className="px-3 py-2">
                      {i.img
                        ? <div className="relative w-14 h-14">
                            <img src={i.img} alt={i.name} className="w-14 h-14 rounded-xl object-cover border shadow-sm" onError={(e) => { e.target.style.display = "none"; e.target.parentElement.querySelector(".img-fallback").style.display = "flex"; }} />
                            <div className="img-fallback w-14 h-14 rounded-xl border bg-gray-100 flex-col items-center justify-center text-gray-300 absolute top-0 left-0" style={{ display: "none" }}>
                              <span className="text-2xl leading-none">📷</span>
                            </div>
                          </div>
                        : <div className="w-14 h-14 rounded-xl border bg-gray-100 flex flex-col items-center justify-center text-gray-300">
                            <span className="text-2xl leading-none">📷</span>
                            <span className="text-xs mt-0.5">No photo</span>
                          </div>
                      }
                    </td>
                    <td className="px-2.5 py-2">
                      <p className="font-medium text-gray-900">{i.name}</p>
                      <p className="text-xs text-gray-400">{i.code || i.id} · {i.unit}{i.size ? ` · ${i.size}` : ""}</p>
                    </td>
                    <td className="px-2.5 py-2"><TypeBadge type={i.type} /></td>
                    <td className="px-2.5 py-2"><Badge color="gray">{i.cat}</Badge></td>
                    <td className="px-2.5 py-2">{i.subCat ? <span className="text-xs text-violet-600 font-medium">{i.subCat}</span> : <span className="text-xs text-gray-300">—</span>}</td>
                    <td className="px-2.5 py-2 font-medium">{i.qty}</td>
                    <td className="px-2.5 py-2">
                      {zero
                        ? <span className="inline-flex items-center gap-1 font-bold text-red-600 text-xs bg-red-100 px-2 py-0.5 rounded-full">🚫 Out of stock</span>
                        : low
                          ? <span className="inline-flex items-center gap-1 font-bold text-amber-700 text-xs bg-amber-100 px-2 py-0.5 rounded-full">⚠️ {avail} left</span>
                          : <span className="font-medium text-green-700">{avail}</span>
                      }
                    </td>
                    <td className="px-2.5 py-2 text-amber-700">{i.blocked || 0}</td>
                    <td className="px-2.5 py-2 text-gray-500">{(() => { const b = locationBreakdown(settings, i); if (b.length <= 1) return b[0]?.loc || i.loc || "—"; return <div className="space-y-0.5">{b.map((x, k) => <div key={k} className="text-xs whitespace-nowrap">{x.fixed && <span title="Installed / standing at this venue">🏛️ </span>}{x.loc}: <b className="text-gray-700">{x.qty}</b></div>)}</div>; })()}</td>
                    <td className="px-2 py-2 align-top">
                      {i.price ? (() => {
                        const dp = settings?.datePricing;
                        const tiers = dp ? Object.entries(dp.categories || {}).map(([k, cat]) => ({ k, label: cat.label, price: Math.round(i.price * cat.multiplier), mult: cat.multiplier })) : [];
                        return (<div className="flex flex-col gap-0.5 items-start">
                          <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">Base {fmt(i.price)}</span>
                          {tiers.map((t) => (
                            <span key={t.k} className={"text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap " + PRICING_CAT_STYLES[t.k]}>
                              {t.mult}× {fmt(t.price)}
                            </span>
                          ))}
                        </div>);
                      })()
                        : i.itemClass === "bulk" ? <span className="text-gray-600 text-sm">{i.usageChargePct || 5}% usage</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-2.5 py-2">
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setBlockModal(i.id); setBlockForm({ fnId: "", qty: 1, dept: "Flower", remark: "", sizeClass: "M" }); }}
                          className={"text-xs hover:underline whitespace-nowrap " + (zero ? "text-gray-400" : "text-indigo-600")}>🔒 Block</button>
                        <button onClick={() => openEdit(i.id)} className="text-xs text-violet-600 hover:underline whitespace-nowrap">✏️ Edit</button>
                        <button onClick={() => deleteItem(i.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan="10" className="px-4 py-10 text-center text-gray-400">No items found</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-3">
          <p className="text-sm text-gray-500">Showing {safePage * INV_PAGE_SIZE + 1}–{Math.min((safePage + 1) * INV_PAGE_SIZE, filtered.length)} of {filtered.length} items</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setInvPage(0)} disabled={safePage === 0} className="px-2 py-1 rounded text-sm disabled:opacity-30 hover:bg-gray-100">«</button>
            <button onClick={() => setInvPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="px-2 py-1 rounded text-sm disabled:opacity-30 hover:bg-gray-100">‹ Prev</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let pg;
              if (totalPages <= 7) pg = i;
              else if (safePage < 4) pg = i;
              else if (safePage > totalPages - 5) pg = totalPages - 7 + i;
              else pg = safePage - 3 + i;
              return <button key={pg} onClick={() => setInvPage(pg)} className={"px-2.5 py-1 rounded text-sm font-medium " + (pg === safePage ? "bg-indigo-600 text-white" : "hover:bg-gray-100 text-gray-600")}>{pg + 1}</button>;
            })}
            <button onClick={() => setInvPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} className="px-2 py-1 rounded text-sm disabled:opacity-30 hover:bg-gray-100">Next ›</button>
            <button onClick={() => setInvPage(totalPages - 1)} disabled={safePage >= totalPages - 1} className="px-2 py-1 rounded text-sm disabled:opacity-30 hover:bg-gray-100">»</button>
          </div>
        </div>
      )}

      {/* ── Hidden camera input (triggered by openPhotoScan) ─────────── */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />

      {/* ── Photo Scan & Add Modal ───────────────────────────────────────── */}
      <Modal open={photoModal} onClose={() => setPhotoModal(false)} title="📷 Scan & Add to Inventory" wide>
        <div className="space-y-4">
          {/* Photo preview + retake */}
          <div className="flex items-start gap-4">
            {photoImg
              ? <div className="relative flex-shrink-0">
                  <img src={photoImg} alt="Captured" className="w-36 h-36 rounded-2xl object-cover border-2 border-green-400 shadow-md" />
                  {photoLoading && (
                    <div className="absolute inset-0 rounded-2xl bg-black/50 flex flex-col items-center justify-center">
                      <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin mb-2"></div>
                      <span className="text-white text-xs font-medium">AI Reading...</span>
                    </div>
                  )}
                  {!photoLoading && photoReady && (
                    <div className="absolute -top-2 -right-2 w-7 h-7 bg-green-500 rounded-full flex items-center justify-center text-white text-sm shadow">✓</div>
                  )}
                </div>
              : <div className="w-36 h-36 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-2 flex-shrink-0">
                  <span className="text-4xl">📷</span>
                  <span className="text-xs text-gray-400">Photo will appear here</span>
                </div>
            }
            <div className="flex-1 min-w-0">
              {!photoImg && !photoLoading && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="font-bold text-green-800 text-sm">How it works</p>
                  <p className="text-xs text-green-700 mt-1 leading-relaxed">Point your camera at any inventory item — arch, chair, chandelier, fabric roll, anything. AI will identify it and auto-fill the form. You just confirm qty and location.</p>
                  <label className="mt-3 inline-flex items-center gap-2 cursor-pointer bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-lg font-medium">
                    📷 Open Camera
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
                  </label>
                  <span className="mx-2 text-gray-400 text-xs">or</span>
                  <label className="cursor-pointer text-sm text-green-700 underline">
                    Upload from gallery
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoCapture} />
                  </label>
                </div>
              )}
              {photoLoading && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="font-semibold text-amber-800 text-sm">🤖 AI is identifying the item...</p>
                  <p className="text-xs text-amber-700 mt-1">Detecting item type · Suggesting category · Estimating details</p>
                </div>
              )}
              {photoError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">⚠️ {photoError}</div>
              )}
              {photoReady && !photoLoading && (
                <div className={`border rounded-xl p-3 text-sm ${form._aiConfidence === "High" ? "bg-green-50 border-green-200" : form._aiConfidence === "Low" ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"}`}>
                  <p className={`font-bold text-sm ${form._aiConfidence === "High" ? "text-green-800" : form._aiConfidence === "Low" ? "text-amber-800" : "text-blue-800"}`}>
                    {form._aiConfidence === "High" ? "✅ High confidence — looks good!" : form._aiConfidence === "Low" ? "⚠️ Low confidence — please verify fields" : "ℹ️ Medium confidence — review details"}
                  </p>
                  <p className={`text-xs mt-1 ${form._aiConfidence === "High" ? "text-green-700" : form._aiConfidence === "Low" ? "text-amber-700" : "text-blue-700"}`}>
                    Review the auto-filled fields below. Update qty, location and price before saving.
                  </p>
                  <label className="mt-2 inline-flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 underline">
                    📷 Retake photo
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Pre-filled form — shown once photo is taken */}
          {(photoImg || photoReady) && (
            <div className={`space-y-3 transition-opacity ${photoLoading ? "opacity-30 pointer-events-none" : ""}`}>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-600">Item Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full border-2 border-indigo-300 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm font-medium outline-none"
                    placeholder="e.g. Rose Arch Large" />
                </div>
                {[["Category", "cat", "select", (studioCatLabels.length > 0 ? studioCatLabels : INV_CATS)], ["Type", "type", "select", ["Budgeted", "Premium", "In-house"]], ["Class", "itemClass", "select", ["discrete", "bulk"]], ["Unit", "unit", "select", ["Piece", "Set", "Kg", "Metre", "Bundle", "Roll"]]].map(([l, k, t, opts]) => (
                  <div key={k}>
                    <label className="text-xs text-gray-500">{l}</label>
                    <select value={form[k]} onChange={(e) => { setForm({ ...form, [k]: e.target.value, ...(k === "cat" ? { subCat: "" } : {}) }); setSubOtherAdd(false); }}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
                      {opts.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                {/* Sub-Category — Tier 1.2 · scoped by selected Studio cat · Other-custom for orphans */}
                <div>
                  <label className="text-xs text-gray-500">Sub-Category</label>
                  <select
                    value={subOtherAdd ? SUBCAT_OTHER : (form.subCat || "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === SUBCAT_OTHER) { setSubOtherAdd(true); setForm({ ...form, subCat: "" }); }
                      else { setSubOtherAdd(false); setForm({ ...form, subCat: v }); }
                    }}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option>
                    {subcatsForCat(form.cat).map((sc) => <option key={sc} value={sc}>{sc}</option>)}
                    <option value={SUBCAT_OTHER}>✏️ Other (custom)…</option>
                  </select>
                  {subOtherAdd && (
                    <input value={form.subCat || ""} onChange={(e) => setForm({ ...form, subCat: e.target.value })}
                      autoFocus placeholder="Type custom sub-cat (Tarun: add to Studio later)"
                      className="mt-1 w-full border-2 border-amber-300 rounded-lg px-3 py-2 text-sm" />
                  )}
                  {studioLoading && studioSubcats.length === 0 && (
                    <p className="text-[10px] text-gray-400 mt-1">Loading sub-categories from Studio…</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-orange-600">Quantity * (verify!)</label>
                  <input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
                    className="mt-1 w-full border-2 border-orange-300 focus:border-orange-500 rounded-lg px-3 py-2 text-sm font-bold outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-orange-600">Location * (verify!)</label>
                  <input value={form.loc} onChange={(e) => setForm({ ...form, loc: e.target.value })}
                    className="mt-1 w-full border-2 border-orange-300 focus:border-orange-500 rounded-lg px-3 py-2 text-sm outline-none"
                    placeholder="e.g. Rack A1 or Yard" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Rental Price ₹</label>
                  <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Cost Price ₹</label>
                  <input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500">Notes / AI Description</label>
                  <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-600" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { addItem(); setPhotoModal(false); }} disabled={!form.name || !form.qty}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg py-3 text-sm font-bold">
                  ✅ Add to Inventory
                </button>
                <button onClick={() => setPhotoModal(false)}
                  className="px-2.5 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Add Item Modal (with inline photo scan) ─────────────────────── */}
      <Modal open={addModal} onClose={() => { setAddModal(false); setPhotoImg(null); setPhotoReady(false); setPhotoError(""); setSubOtherAdd(false); }} title="Add Inventory Item" wide>
        <div className="space-y-4">

          {/* ── Photo Capture Section ───────────────────────────────────── */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4">
            <div className="flex items-start gap-4">
              {/* Photo preview */}
              <div className="flex-shrink-0">
                {form.img
                  ? <div className="relative">
                      <img src={form.img} alt="Item" className="w-24 h-24 rounded-xl object-cover border-2 border-green-400 shadow" onError={(e) => { e.target.onerror = null; e.target.style.display = "none"; }} />
                      {photoLoading && (
                        <div className="absolute inset-0 rounded-xl bg-black/50 flex flex-col items-center justify-center">
                          <div className="w-6 h-6 border-white/30 border-t-white rounded-full animate-spin mb-1" style={{ borderWidth: "3px" }}></div>
                          <span className="text-white text-xs">Reading...</span>
                        </div>
                      )}
                      {!photoLoading && photoReady && (
                        <div className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs shadow">✓</div>
                      )}
                    </div>
                  : <div className="w-24 h-24 rounded-xl border-2 border-dashed border-green-300 bg-white flex flex-col items-center justify-center gap-1 text-green-400">
                      <span className="text-3xl leading-none">📷</span>
                      <span className="text-xs">No photo</span>
                    </div>
                }
              </div>

              {/* Camera controls */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-green-800 mb-1">📷 Click Photo → AI Auto-fills</p>
                <p className="text-xs text-green-700 mb-3 leading-relaxed">Take a photo of the item — AI will identify it and fill Name, Category, Type, Unit and Notes automatically.</p>
                <div className="flex flex-wrap gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-2 rounded-lg font-semibold transition-colors">
                    📸 Camera
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={(e) => { const file = e.target.files[0]; if (!file) return; const r = new FileReader(); r.onload = async (ev) => { const d = ev.target.result; setPhotoImg(d); setForm((f) => ({ ...f, img: d })); await runPhotoAI(d); }; r.readAsDataURL(file); }} />
                  </label>
                  <label className="cursor-pointer inline-flex items-center gap-1.5 bg-white border border-green-400 hover:bg-green-50 text-green-700 text-xs px-3 py-2 rounded-lg font-medium transition-colors">
                    🖼️ Gallery
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const file = e.target.files[0]; if (!file) return; const r = new FileReader(); r.onload = async (ev) => { const d = ev.target.result; setPhotoImg(d); setForm((f) => ({ ...f, img: d })); await runPhotoAI(d); }; r.readAsDataURL(file); }} />
                  </label>
                  {form.img && <button onClick={() => { setPhotoImg(null); setPhotoReady(false); setForm((f) => ({ ...f, img: "" })); }} className="text-xs text-red-400 hover:text-red-600 px-2 py-2">✕ Clear</button>}
                </div>

                {/* AI status */}
                {photoLoading && <p className="text-xs text-amber-700 font-medium mt-2 animate-pulse">🤖 AI identifying item...</p>}
                {photoError && <p className="text-xs text-red-600 mt-2">⚠️ {photoError}</p>}
                {photoReady && !photoLoading && !photoError && (
                  <div className={`mt-2 text-xs font-medium px-2 py-1 rounded-lg inline-block ${form._aiConfidence === "High" ? "bg-green-100 text-green-700" : form._aiConfidence === "Low" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                    {form._aiConfidence === "High" ? "✅ High confidence — form filled!" : form._aiConfidence === "Low" ? "⚠️ Low confidence — please verify" : "ℹ️ Medium confidence — review fields"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Fields (dimmed while AI loading) ──────────────────────── */}
          <div className={`grid grid-cols-2 gap-3 transition-opacity ${photoLoading ? "opacity-40 pointer-events-none" : ""}`}>
            {/* Item Name + Voice */}
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Item Name *</label>
              <div className="flex gap-2 mt-1">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={"flex-1 border rounded-lg px-3 py-2 text-sm " + (photoReady && form.name ? "border-green-400 bg-green-50" : "")}
                  placeholder="e.g. Rose Arch Large" />
                <button onClick={startVoice} title="Voice input"
                  className={"px-3 py-2 rounded-lg border text-sm " + (listening ? "bg-red-100 border-red-300 text-red-600 animate-pulse" : "bg-gray-100 hover:bg-gray-200")}>
                  🎙️
                </button>
              </div>
            </div>

            {/* Selects */}
            {[["Category", "cat", "select", (studioCatLabels.length > 0 ? studioCatLabels : INV_CATS)], ["Type", "type", "select", ["Budgeted", "Premium", "In-house"]], ["Class", "itemClass", "select", ["discrete", "bulk"]], ["Unit", "unit", "select", ["Piece", "Set", "Kg", "Metre", "Bundle", "Roll"]]].map(([l, k, t, opts]) => (
              <div key={k}>
                <label className="text-xs text-gray-500">{l}</label>
                <select value={form[k]} onChange={(e) => { setForm({ ...form, [k]: e.target.value, ...(k === "cat" ? { subCat: "" } : {}) }); }}
                  className={"mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white " + (photoReady ? "border-green-300" : "")}>
                  {opts.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            {/* Sub-Category — Tier 1.2 · scoped by selected Studio cat (AI-driven flow, no orphan custom) */}
            <div>
              <label className="text-xs text-gray-500">Sub-Category</label>
              <select value={form.subCat || ""} onChange={(e) => setForm({ ...form, subCat: e.target.value })}
                className={"mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white " + (photoReady ? "border-green-300" : "")}>
                <option value="">— Select —</option>
                {subcatsForCat(form.cat).map((sc) => <option key={sc} value={sc}>{sc}</option>)}
                {form.subCat && !subcatsForCat(form.cat).includes(form.subCat) && <option value={form.subCat}>{form.subCat} (AI guess)</option>}
              </select>
            </div>

            {/* Number / text fields */}
            {[["Quantity *", "qty", "number"], ["Rental Price ₹", "price", "number"], ["Cost Price ₹", "cost", "number"], ["Breakage %", "breakagePct", "number"]].map(([l, k, t]) => (
              <div key={k}>
                <label className="text-xs text-gray-500">{l}</label>
                <input type={t} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            ))}
            {/* Location dropdown */}
            <div>
              <label className="text-xs text-gray-500">Location</label>
              <select value={form.loc || ""} onChange={(e) => setForm({ ...form, loc: e.target.value })}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
                {INV_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                {form.loc && !INV_LOCATIONS.includes(form.loc) && <option value={form.loc}>{form.loc}</option>}
              </select>
            </div>
            {/* Dimensions (L × W × H) — matches Edit form */}
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Dimensions (L × W × H)</label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                <input type="number" min="0" step="0.1" value={form.dimL || ""} onChange={(e) => setForm({ ...form, dimL: e.target.value })} placeholder="L" className="border rounded-lg px-3 py-2 text-sm" />
                <input type="number" min="0" step="0.1" value={form.dimW || ""} onChange={(e) => setForm({ ...form, dimW: e.target.value })} placeholder="W" className="border rounded-lg px-3 py-2 text-sm" />
                <input type="number" min="0" step="0.1" value={form.dimH || ""} onChange={(e) => setForm({ ...form, dimH: e.target.value })} placeholder="H" className="border rounded-lg px-3 py-2 text-sm" />
                <select value={form.dimUnit || "Feet"} onChange={(e) => setForm({ ...form, dimUnit: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                  <option>Feet</option><option>Inches</option><option>Cm</option><option>Metre</option>
                </select>
              </div>
            </div>

            {/* Printable dimensions (optional) */}
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Printable Area (L × W) — <span className="italic">optional, for items with hollow/print space</span></label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                <input type="number" min="0" step="0.1" value={form.printL || ""} onChange={(e) => setForm({ ...form, printL: e.target.value })} placeholder="L" className="border rounded-lg px-3 py-2 text-sm" />
                <input type="number" min="0" step="0.1" value={form.printW || ""} onChange={(e) => setForm({ ...form, printW: e.target.value })} placeholder="W" className="border rounded-lg px-3 py-2 text-sm" />
                <div></div>
                <select value={form.printUnit || "Feet"} onChange={(e) => setForm({ ...form, printUnit: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                  <option>Feet</option><option>Inches</option><option>Cm</option><option>Metre</option>
                </select>
              </div>
            </div>

            {/* Paint Override — shown for paintable categories */}
            {(() => {
              const PAINT_TOKENS = ["truss", "struct", "mask", "platform", "carpet", "furniture", "arch", "prop", "panel", "pillar", "glass", "stage", "wrought", "consumable"];
              const cat = String(form.cat || "").toLowerCase();
              const subcat = String(form.subCat || "").toLowerCase();
              if (!PAINT_TOKENS.some((tok) => cat.includes(tok) || subcat.includes(tok))) return null;
              const colours = (settings?.colourCatalogue || []).map((c) => c.name);
              return (
                <div className="col-span-2 bg-pink-50 border border-pink-200 rounded-xl p-3 space-y-2">
                  <span className="text-xs font-bold text-pink-800">🎨 Paint Override Settings</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-600">Base Colour</label>
                      <select value={form.baseColour || ""} onChange={(e) => setForm({ ...form, baseColour: e.target.value })}
                        className="mt-1 w-full border border-pink-200 rounded-lg px-3 py-2 text-sm">
                        <option value="">— Not set —</option>
                        {colours.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Repaint Cost (₹)</label>
                      <input type="number" min="0" step="50" value={form.paintCost || ""} onChange={(e) => setForm({ ...form, paintCost: e.target.value })}
                        placeholder={String(settings?.defaultPaintCostPerItem || 400)}
                        className="mt-1 w-full border border-pink-200 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Notes */}
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Notes {photoReady && form.notes && <span className="text-green-600 text-xs">(AI filled)</span>}</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className={"mt-1 w-full border rounded-lg px-3 py-2 text-sm " + (photoReady && form.notes ? "border-green-300 bg-green-50" : "")} />
            </div>
          </div>
        </div>

        <button onClick={addItem} disabled={!form.name}
          className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg py-2.5 text-sm font-semibold">
          + Add to Inventory
        </button>
      </Modal>

      {/* ── Item Detail Modal ─────────────────────────────────────────── */}
      <Modal open={!!detailItem} onClose={() => setDetailItem(null)} title={selItem?.name || ""} wide>
        {selItem && <div className="space-y-4">
          <div className="flex gap-4">
            {selItem.img
              ? <img src={selItem.img} alt="" className="w-28 h-28 rounded-xl object-cover border shadow" onError={(e) => { e.target.onerror = null; e.target.src = ""; e.target.style.display = "none"; }} />
              : <div className="w-28 h-28 rounded-xl border bg-gray-100 flex flex-col items-center justify-center text-gray-300 flex-shrink-0"><span className="text-4xl">📷</span><span className="text-xs mt-1">No photo</span></div>
            }
            <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm flex-1">
              {[["Category", selItem.cat], ["Type", selItem.type], ["Class", selItem.itemClass], ["Qty", selItem.qty + " " + selItem.unit], ["Available", (selItem.qty - (selItem.blocked || 0)) + " " + selItem.unit], ["Blocked", (selItem.blocked || 0) + " " + selItem.unit], ["Location", selItem.loc], ["Rental Price", selItem.price ? fmt(selItem.price) : "—"], ["Cost", fmt(selItem.cost)], ["Breakage", selItem.breakagePct + "%"]].map(([l, v]) => (
                <div key={l}><span className="text-gray-400">{l}: </span><span className="font-medium text-gray-800">{v}</span></div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-gray-700 mb-2 text-sm">Blocked for Functions:</h4>
            {functions.filter((f) => f.items?.some((it) => it.invId === selItem.id)).length === 0
              ? <p className="text-sm text-gray-400 italic">Not blocked for any function</p>
              : functions.filter((f) => f.items?.some((it) => it.invId === selItem.id)).map((f) => {
                  const it = f.items.find((it) => it.invId === selItem.id);
                  return <div key={f.id} className="flex items-center gap-3 py-2 border-b text-sm">
                    <span className="font-medium">{f.name}</span><span className="text-gray-500">{f.date}</span>
                    <Badge color="indigo">{it.dept}</Badge><span className="text-gray-500 text-xs">{it.remark}</span>
                    <span className="ml-auto font-medium">×{it.qty}</span>
                  </div>;
                })
            }
          </div>
          <div className="flex justify-end pt-3 border-t">
            <button onClick={() => openEdit(selItem.id)}
              className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-medium">
              ✏️ Edit Item
            </button>
          </div>
        </div>}
      </Modal>

      {/* ── Edit Item Modal ─────────────────────────────────────────────── */}
      <Modal open={!!editModal} onClose={() => { setEditModal(null); setEditForm({}); }} title={`✏️ Edit — ${editForm.name || ""}`} wide>
        {editModal && (() => {
          const orig = inventory.find((i) => i.id === editModal);
          const flags = [];
          if (orig?._pendingApproval) flags.push({ k: "approval", label: "Pending approval", color: "amber" });
          if (orig?._needsPricing) flags.push({ k: "pricing", label: "Needs pricing", color: "red" });
          if (orig?._dimUnitMismatch) flags.push({ k: "dim", label: "Dim unit mismatch", color: "orange" });
          if (orig?._needsCatMigration) flags.push({ k: "catmig", label: "Category needs migration", color: "amber" });
          const subOpts = subcatsForCat(editForm.cat);
          const catOpts = studioCatLabels.length > 0 ? studioCatLabels : (categories || INV_CATS);
          const isLegacy = isLegacyCat(editForm.cat);
          const kitPrice = kitPriceFrom(editForm.subItems);
          const kitComponentOpts = inventory.filter((i) => i.id !== editForm.id && !(editForm.subItems || []).some((s) => s.itemId === i.id));
          return (
            <div className="space-y-4">
              {/* Cat-migration banner — Tier 1.2 manual review */}
              {(orig?._needsCatMigration || isLegacy) && (
                <div className="bg-amber-100 border-2 border-amber-400 rounded-xl p-3 text-xs">
                  <p className="font-bold text-amber-900 mb-0.5">⚠ Category needs migration</p>
                  <p className="text-amber-800">
                    This item still uses the legacy category <span className="font-mono bg-white/60 px-1 rounded">{editForm.cat || "—"}</span>.
                    Pick the correct Studio category below — saving will update it permanently.
                  </p>
                </div>
              )}

              {/* Status banner — flags + auto-clear hint */}
              {flags.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-bold text-amber-800">Flags on this item:</span>
                    {flags.map((fl) => <Badge key={fl.k} color={fl.color}>{fl.label}</Badge>)}
                  </div>
                  <p className="text-amber-700 italic">
                    Saving will clear flags automatically — Pending approval clears on any save; Needs pricing clears when price &gt; 0; Dim unit mismatch clears when L/W/H + unit are set; Category migration clears when you pick a Studio cat.
                  </p>
                </div>
              )}

              {/* Photo */}
              <div className="flex gap-4 items-start">
                <div className="relative">
                  {editForm.img
                    ? <img src={editForm.img} alt="" className="w-32 h-32 rounded-xl object-cover border shadow" onError={(e) => { e.target.style.display = "none"; }} />
                    : <div className="w-32 h-32 rounded-xl border bg-gray-100 flex flex-col items-center justify-center text-gray-300"><span className="text-4xl">📷</span><span className="text-xs mt-1">No photo</span></div>
                  }
                  {editPhotoUploading && (
                    <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center text-white text-xs">
                      Uploading…
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <input ref={editPhotoInputRef} type="file" accept="image/*" onChange={handleEditPhoto} className="hidden" />
                  <button onClick={() => editPhotoInputRef.current?.click()} disabled={editPhotoUploading}
                    className={"text-xs px-3 py-2 rounded-lg font-medium " + (editPhotoUploading ? "bg-gray-200 text-gray-400" : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200")}>
                    {editPhotoUploading ? "Uploading…" : "📤 Upload new photo"}
                  </button>
                  {editForm.img && (
                    <button onClick={() => setEditForm((f) => ({ ...f, img: "" }))}
                      className="text-xs px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 text-left">
                      Remove photo
                    </button>
                  )}
                  <p className="text-xs text-gray-400">Auto-uploads to Cloudinary on pick. Replaces existing URL.</p>
                </div>
              </div>

              {/* Core identity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Name</label>
                  <input type="text" value={editForm.name || ""} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Item ID</label>
                  <input type="text" value={editForm.id || ""} disabled
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400" />
                </div>
              </div>

              {/* Category / Sub-cat / Type */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Category {isLegacy && <span className="text-amber-600 font-bold">⚠</span>}</label>
                  <select value={editForm.cat || ""} onChange={(e) => setEditForm((f) => ({ ...f, cat: e.target.value, subCat: "" }))}
                    className={"mt-1 w-full border rounded-lg px-3 py-2 text-sm " + (isLegacy ? "border-2 border-amber-400 bg-amber-50" : "")}>
                    {catOpts.map((c) => <option key={c} value={c}>{c}</option>)}
                    {editForm.cat && !catOpts.includes(editForm.cat) && <option value={editForm.cat}>{editForm.cat} (legacy — pick new)</option>}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Sub-Category</label>
                  {subOpts.length > 0
                    ? <select value={editForm.subCat || ""} onChange={(e) => setEditForm((f) => ({ ...f, subCat: e.target.value }))}
                        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                        <option value="">— none —</option>
                        {subOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                        {editForm.subCat && !subOpts.includes(editForm.subCat) && <option value={editForm.subCat}>{editForm.subCat} (current)</option>}
                      </select>
                    : <input type="text" value={editForm.subCat || ""} onChange={(e) => setEditForm((f) => ({ ...f, subCat: e.target.value }))}
                        placeholder="(no sub-cats configured)"
                        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  }
                </div>
                <div>
                  <label className="text-xs text-gray-500">Type</label>
                  <select value={editForm.type || "Budgeted"} onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                    <option>Budgeted</option><option>Premium</option><option>In-house</option><option>Indoor</option><option>Outdoor</option>
                  </select>
                </div>
              </div>

              {/* Class / Qty / Unit */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Class</label>
                  <select value={editForm.itemClass || "discrete"} onChange={(e) => setEditForm((f) => ({ ...f, itemClass: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="discrete">Discrete (countable)</option>
                    <option value="bulk">Bulk (kg/m/etc)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Qty Owned</label>
                  <input type="number" min="0" value={editForm.qty || ""} onChange={(e) => setEditForm((f) => ({ ...f, qty: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Unit</label>
                  <select value={editForm.unit || "Piece"} onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                    <option>Piece</option><option>Pieces</option><option>Set</option><option>Kg</option><option>Metre</option><option>Bundle</option><option>Roll</option>
                  </select>
                </div>
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Rental Price (₹){editForm.isKit && <span className="text-indigo-600 font-bold"> · auto (kit)</span>}</label>
                  <input type="number" min="0" value={editForm.isKit ? kitPrice : (editForm.price || "")} disabled={editForm.isKit} onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                    className={"mt-1 w-full border rounded-lg px-3 py-2 text-sm " + (editForm.isKit ? "bg-indigo-50 text-indigo-700 font-semibold" : (orig?._needsPricing ? "border-red-300 bg-red-50" : ""))} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Cost (₹)</label>
                  <input type="number" min="0" value={editForm.cost || ""} onChange={(e) => setEditForm((f) => ({ ...f, cost: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Breakage %</label>
                  <input type="number" min="0" max="100" value={editForm.breakagePct || 0} onChange={(e) => setEditForm((f) => ({ ...f, breakagePct: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Dimensions */}
              <div>
                <label className="text-xs text-gray-500">Dimensions (L × W × H)</label>
                <div className={"grid grid-cols-4 gap-2 mt-1 " + (orig?._dimUnitMismatch ? "p-2 border border-orange-300 bg-orange-50 rounded-lg" : "")}>
                  <input type="number" min="0" step="0.1" placeholder="L" value={editForm.dimL || ""} onChange={(e) => setEditForm((f) => ({ ...f, dimL: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm" />
                  <input type="number" min="0" step="0.1" placeholder="W" value={editForm.dimW || ""} onChange={(e) => setEditForm((f) => ({ ...f, dimW: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm" />
                  <input type="number" min="0" step="0.1" placeholder="H" value={editForm.dimH || ""} onChange={(e) => setEditForm((f) => ({ ...f, dimH: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm" />
                  <select value={editForm.dimUnit || "Feet"} onChange={(e) => setEditForm((f) => ({ ...f, dimUnit: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm">
                    <option>Feet</option><option>Inches</option><option>Cm</option><option>Metre</option>
                  </select>
                </div>
                {orig?._dimUnitMismatch && <p className="text-xs text-orange-700 mt-1 italic">⚠ Original had mixed units. Pick one and re-enter values.</p>}
              </div>

              {/* Printable area (optional) */}
              <div>
                <label className="text-xs text-gray-500">Printable Area (L × W) — <span className="italic">optional</span></label>
                <div className="grid grid-cols-4 gap-2 mt-1">
                  <input type="number" min="0" step="0.1" placeholder="L" value={editForm.printL || ""} onChange={(e) => setEditForm((f) => ({ ...f, printL: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm" />
                  <input type="number" min="0" step="0.1" placeholder="W" value={editForm.printW || ""} onChange={(e) => setEditForm((f) => ({ ...f, printW: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm" />
                  <div></div>
                  <select value={editForm.printUnit || "Feet"} onChange={(e) => setEditForm((f) => ({ ...f, printUnit: e.target.value }))}
                    className="border rounded-lg px-3 py-2 text-sm">
                    <option>Feet</option><option>Inches</option><option>Cm</option><option>Metre</option>
                  </select>
                </div>
              </div>

              {/* §23 Phase 2.9 — Paint override fields (only shown for paintable categories) */}
              {(() => {
                const PAINT_TOKENS = ["truss", "struct", "mask", "platform", "carpet", "furniture", "arch", "prop", "panel", "pillar", "glass", "stage", "wrought", "consumable"];
                const cat = String(editForm.cat || "").toLowerCase();
                const subcat = String(editForm.subCat || "").toLowerCase();
                const isPaintable = PAINT_TOKENS.some((tok) => cat.includes(tok) || subcat.includes(tok));
                if (!isPaintable) return null;
                const colours = (settings.colourCatalogue || []).map((c) => c.name);
                return (
                  <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-pink-800">🎨 Paint Override Settings</span>
                      <span className="text-xs text-pink-600">— shipping default + per-event repaint cost</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-600">Base Colour (shipped as)</label>
                        <select value={editForm.baseColour || ""} onChange={(e) => setEditForm((f) => ({ ...f, baseColour: e.target.value }))}
                          className="mt-1 w-full border border-pink-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">— Not set —</option>
                          {colours.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Repaint Cost (₹ per item, if overridden)</label>
                        <input type="number" min="0" step="50" value={editForm.paintCost || ""} onChange={(e) => setEditForm((f) => ({ ...f, paintCost: e.target.value }))}
                          placeholder={String(settings.defaultPaintCostPerItem || 400)}
                          className="mt-1 w-full border border-pink-200 rounded-lg px-3 py-2 text-sm" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 italic">Salespeople ship base colour by default. If they override (via Studio Build), Ops paints the item and this cost is added to the event.</p>
                  </div>
                );
              })()}

              {/* §7.9.5 — Kit / Composite builder */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!editForm.isKit} onChange={(e) => setEditForm((f) => ({ ...f, isKit: e.target.checked, subItems: e.target.checked ? (f.subItems || []) : f.subItems }))} className="w-4 h-4 accent-indigo-600" />
                  <span className="text-xs font-bold text-indigo-800">📦 This item is a kit</span>
                  <span className="text-xs text-indigo-600">— blocking it auto-blocks the components below</span>
                </label>

                {editForm.isKit && (
                  <div className="space-y-2">
                    {(editForm.subItems || []).length === 0 && (
                      <p className="text-xs text-gray-500 italic">No components yet — add the items this kit contains (e.g. Console Table ×1, Flower Pot ×3, Candle ×6).</p>
                    )}
                    {(editForm.subItems || []).map((si, idx) => {
                      const child = inventory.find((i) => i.id === si.itemId);
                      const childRental = child ? (Number(child.price ?? child.rentalCost) || 0) : 0;
                      const lineTotal = childRental * (Number(si.qty) || 0);
                      return (
                        <div key={idx} className="flex items-center gap-2 bg-white border border-indigo-100 rounded-lg px-2 py-1.5">
                          <span className="flex-1 text-xs font-medium text-gray-700 truncate">{child ? child.name : `⚠ ${si.itemId} (missing)`}</span>
                          <span className="text-xs text-gray-400">₹{childRental.toLocaleString("en-IN")} ea</span>
                          <input type="number" min="1" value={si.qty} onChange={(e) => { const q = e.target.value; setEditForm((f) => ({ ...f, subItems: f.subItems.map((s, i) => i === idx ? { ...s, qty: q } : s) })); }}
                            className="w-14 border rounded-md px-2 py-1 text-xs text-center" />
                          <span className="text-xs font-semibold text-indigo-700 w-20 text-right">₹{lineTotal.toLocaleString("en-IN")}</span>
                          <button onClick={() => setEditForm((f) => ({ ...f, subItems: f.subItems.filter((_, i) => i !== idx) }))}
                            className="text-red-400 hover:text-red-600 text-sm px-1" title="Remove">×</button>
                        </div>
                      );
                    })}

                    {/* Add component (datalist autocomplete) */}
                    <div className="flex items-center gap-2">
                      <input list="kit-comp-options" placeholder="🔍 Type an item name to add as a component…"
                        onChange={(e) => { const name = e.target.value; const it = inventory.find((i) => i.name === name && i.id !== editForm.id); if (it) { setEditForm((f) => (f.subItems || []).some((s) => s.itemId === it.id) ? f : ({ ...f, subItems: [...(f.subItems || []), { itemId: it.id, qty: 1 }] })); e.target.value = ""; } }}
                        className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                      <datalist id="kit-comp-options">
                        {kitComponentOpts.map((i) => <option key={i.id} value={i.name}>{`₹${(Number(i.price ?? i.rentalCost) || 0)} · ${i.cat || i.category || ""}`}</option>)}
                      </datalist>
                    </div>

                    {/* Live kit price */}
                    <div className="flex items-center justify-between border-t border-indigo-200 pt-2 mt-1">
                      <span className="text-xs font-bold text-indigo-800">Kit rental price (auto)</span>
                      <span className="text-sm font-bold text-indigo-700">₹{kitPrice.toLocaleString("en-IN")}</span>
                    </div>
                    <p className="text-xs text-gray-500 italic">Auto-summed from each component's rental × qty. Editing a component's rental anywhere updates this automatically.</p>
                  </div>
                )}
              </div>

              {/* Location / Notes */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Location</label>
                  <select value={editForm.loc || ""} onChange={(e) => setEditForm((f) => ({ ...f, loc: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option>
                    {INV_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                    {editForm.loc && !INV_LOCATIONS.includes(editForm.loc) && <option value={editForm.loc}>{editForm.loc} (legacy)</option>}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Notes</label>
                  <input type="text" value={editForm.notes || ""} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Save / Cancel */}
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button onClick={() => { setEditModal(null); setEditForm({}); }}
                  className="text-xs px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
                <button onClick={saveEdit}
                  className="text-xs px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium">
                  💾 Save Changes
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Single Block Modal ────────────────────────────────────────── */}
      <Modal open={!!blockModal} onClose={() => setBlockModal(null)} title={`🔒 Block — ${blockInv?.name || ""}`}>
        <div className="space-y-3">
          {(() => {
            const avail = blockInv ? (blockInv.qty - (blockInv.blocked || 0)) : 0;
            const needed = parseInt(blockForm.qty) || 1;
            const isShort = avail < needed;
            const isZero = avail === 0;
            const alts = blockInv ? findAlternatives(blockInv, inventory, needed, blockInv.id) : [];
            const selFn = blockForm.fnId ? functions.find((f) => f.id === blockForm.fnId) : null;
            const pricing = blockInv && selFn ? getEffectivePricing(blockInv.price || 0, selFn.date, settings) : null;
            return (<>
              {/* Stock status */}
              <div className={"rounded-xl px-3 py-2.5 flex items-center justify-between " + (isZero ? "bg-red-50 border border-red-200" : isShort ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200")}>
                <div>
                  <p className={"text-sm font-semibold " + (isZero ? "text-red-700" : isShort ? "text-amber-700" : "text-green-700")}>
                    {isZero ? "🚫 Out of stock" : isShort ? "⚠️ Insufficient stock" : "✅ In stock"}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Available: <strong>{avail}</strong> {blockInv?.unit} · Requesting: <strong>{needed}</strong>
                    {isShort && !isZero && <span className="text-red-600"> · Shortfall: {needed - avail}</span>}
                  </p>
                </div>
                {isZero && <span className="text-2xl">❌</span>}
                {isShort && !isZero && <span className="text-2xl">⚠️</span>}
                {!isShort && <span className="text-2xl">✅</span>}
              </div>
              {/* Effective price box — shown when function is selected */}
              {pricing && blockInv?.price > 0 && (
                <div className={"rounded-xl px-3 py-2.5 border " + (PRICING_CAT_STYLES[pricing.category] || "bg-gray-50 border-gray-200")}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide opacity-70">{pricing.label}</p>
                      <p className="text-sm mt-0.5">
                        Base <span className="font-medium">{fmt(blockInv.price)}</span>
                        <span className="mx-1.5 opacity-50">×</span>
                        <span className="font-medium">{pricing.multiplier}</span>
                        <span className="mx-1.5 opacity-50">=</span>
                        <span className="text-base font-bold">{fmt(pricing.effectivePrice)}</span>
                        <span className="text-xs opacity-60 ml-1">per {blockInv.unit}</span>
                      </p>
                      <p className="text-xs opacity-60 mt-0.5">{pricing.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs opacity-60">Total ({needed} units)</p>
                      <p className="text-lg font-bold">{fmt(pricing.effectivePrice * needed)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Alternatives — shown when short or zero */}
              {(isShort || isZero) && alts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs font-bold text-amber-800 mb-2">💡 Similar items with available stock:</p>
                  <div className="space-y-1.5">
                    {alts.map((alt) => (
                      <button key={alt.id}
                        onClick={() => { setBlockModal(alt.id); setBlockForm({ ...blockForm, qty: 1 }); }}
                        className="w-full flex items-center gap-3 bg-white hover:bg-amber-100 border border-amber-200 hover:border-amber-400 rounded-lg px-3 py-2.5 text-left transition-all group">
                        {alt.img
                          ? <img src={alt.img} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border" />
                          : <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 flex-shrink-0">📦</div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 group-hover:text-amber-800 truncate">{alt.name}</p>
                          <p className="text-xs text-gray-500">{alt.cat} · {alt.type}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-green-600">{alt._avail} avail</p>
                          <p className="text-xs text-indigo-500 group-hover:text-indigo-700 font-medium">Switch →</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(isShort || isZero) && alts.length === 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">No similar items found in inventory</p>
                </div>
              )}

              <div><label className="text-xs text-gray-500">Function</label>
                <select value={blockForm.fnId} onChange={(e) => setBlockForm({ ...blockForm, fnId: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select function...</option>
                  {functions.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
                </select></div>
              <div><label className="text-xs text-gray-500">Quantity</label>
                <input type="number" min="1" value={blockForm.qty} onChange={(e) => setBlockForm({ ...blockForm, qty: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
              {/* S/M/B dropdown for SMB Lighting items only */}
              {(() => {
                const isLighting = blockInv && String(blockInv.cat || "").toLowerCase() === "lighting";
                if (!isLighting) return null;
                const sub = blockInv?.subCat || "";
                const prod = (settings?.electricianProductivity || {})[sub];
                const isSMB = prod?.mode === "smb";
                if (!isSMB) return null;
                return (
                  <div><label className="text-xs text-gray-500">Size class <span className="text-[10px] text-purple-600 ml-1">(electrician productivity lookup)</span></label>
                    <select value={blockForm.sizeClass || "M"} onChange={(e) => setBlockForm({ ...blockForm, sizeClass: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="S">Small</option>
                      <option value="M">Medium</option>
                      <option value="B">Big</option>
                    </select>
                  </div>
                );
              })()}
              <div><label className="text-xs text-gray-500">Department</label>
                <select value={blockForm.dept} onChange={(e) => setBlockForm({ ...blockForm, dept: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                  {DEPTS.map((d) => <option key={d}>{d}</option>)}
                </select></div>
              <div><label className="text-xs text-gray-500">Remark / Instructions</label>
                <textarea value={blockForm.remark} onChange={(e) => setBlockForm({ ...blockForm, remark: e.target.value })} rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
              <button onClick={blockItem} disabled={isZero}
                className={"w-full rounded-lg py-2 text-sm " + (isZero ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 text-white")}>
                {isZero ? "🚫 Cannot Block — Out of Stock" : "🔒 Block Item" + (isShort ? " (partial)" : "")}
              </button>
            </>);
          })()}
        </div>
      </Modal>

      {/* ── Bulk Block Modal ──────────────────────────────────────────── */}
      <Modal open={bulkModal} onClose={() => setBulkModal(false)} title="📋 Bulk Block Items" wide>
        <div className="space-y-4">
          <div><label className="text-xs text-gray-500">Select Function</label>
            <select value={bulkFnId} onChange={(e) => setBulkFnId(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select function...</option>
              {functions.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
            </select></div>
          {bulkFnId && <>
            <input value={bulkSearch} onChange={(e) => setBulkSearch(e.target.value)} placeholder="🔍 Search items..." className="w-full border rounded-lg px-3 py-2 text-sm" />
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {bulkFiltered.map((i) => {
                const sel = bulkSel[i.id];
                const avail = i.qty - (i.blocked || 0);
                return (
                  <div key={i.id} className={"border rounded-xl p-3 transition-colors " + (sel ? "border-indigo-300 bg-indigo-50" : "hover:bg-gray-50")}>
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={!!sel} onChange={() => toggleBulkItem(i.id)} className="w-4 h-4" />
                      {i.img && <img src={i.img} alt="" className="w-10 h-10 rounded-lg object-cover border" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{i.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <TypeBadge type={i.type} />
                          <span className="text-xs text-gray-500">{i.cat} · {avail} available</span>
                        </div>
                      </div>
                    </div>
                    {sel && (
                      <div className="grid grid-cols-3 gap-2 mt-3 pl-7">
                        <div><label className="text-xs text-gray-500">Qty (max {avail})</label>
                          <input type="number" min="1" max={avail} value={sel.qty}
                            onChange={(e) => updateBulkItem(i.id, "qty", Math.min(parseInt(e.target.value) || 1, avail))}
                            className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                        <div><label className="text-xs text-gray-500">Department</label>
                          <select value={sel.dept} onChange={(e) => updateBulkItem(i.id, "dept", e.target.value)} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm">
                            {DEPTS.map((d) => <option key={d}>{d}</option>)}
                          </select></div>
                        <div><label className="text-xs text-gray-500">Remark</label>
                          <input value={sel.remark} onChange={(e) => updateBulkItem(i.id, "remark", e.target.value)} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Optional..." /></div>
                      </div>
                    )}
                  </div>
                );
              })}
              {bulkFiltered.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No available items</p>}
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-sm text-gray-600">{Object.keys(bulkSel).length} items selected</p>
              <button onClick={submitBulk} disabled={!Object.keys(bulkSel).length}
                className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-5 py-2 rounded-lg text-sm font-medium">
                🔒 Block All Selected
              </button>
            </div>
          </>}
          {!bulkFnId && <p className="text-sm text-gray-400 italic text-center py-4">Select a function first to see available items</p>}
        </div>
      </Modal>

      {/* ── Excel Import Wizard ───────────────────────────────────────── */}
      <Modal open={importModal} onClose={() => setImportModal(false)} title="📥 Import from Excel" wide>
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {["Upload", "Map Columns", "Review", "Done"].map((s, i) => (
            <React.Fragment key={s}>
              <div className={"flex items-center gap-1.5 text-sm " + (importStep > i + 1 ? "text-green-600" : importStep === i + 1 ? "text-indigo-700 font-semibold" : "text-gray-400")}>
                <span className={"w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold " + (importStep > i + 1 ? "bg-green-100 text-green-700" : importStep === i + 1 ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-400")}>
                  {importStep > i + 1 ? "✓" : i + 1}
                </span>
                {s}
              </div>
              {i < 3 && <div className="flex-1 h-px bg-gray-200" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Upload */}
        {importStep === 1 && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
              <p className="text-4xl mb-2">📊</p>
              <p className="text-sm text-gray-600 mb-3">Upload an Excel (.xlsx / .xls) or CSV file</p>
              <label className="cursor-pointer bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">
                Choose File
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelFile} />
              </label>
            </div>
            <p className="text-xs text-gray-400 text-center">Supported columns: Item Name, Category, Type, Quantity, Unit, Location, Box ID, Notes, Price, Cost</p>
          </div>
        )}

        {/* Step 2: Column Map */}
        {importStep === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{importRows.length} rows found. Review and adjust column mappings:</p>
            <div className="grid grid-cols-2 gap-3">
              {[["Item Name", "name"], ["Category", "cat"], ["Inventory Type", "type"], ["Quantity", "qty"], ["Unit", "unit"], ["Location", "loc"], ["Box ID", "boxId"], ["Notes", "notes"], ["Rental Price", "price"], ["Cost Price", "cost"]].map(([label, key]) => {
                const cols = importRows.length ? ["(skip)", ...Object.keys(importRows[0])] : ["(skip)"];
                return (
                  <div key={key}><label className="text-xs text-gray-500">{label}</label>
                    <select value={importMap[key] || "(skip)"} onChange={(e) => setImportMap((m) => ({ ...m, [key]: e.target.value === "(skip)" ? undefined : e.target.value }))}
                      className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm">
                      {cols.map((c) => <option key={c}>{c}</option>)}
                    </select></div>
                );
              })}
            </div>
            {/* Preview */}
            {importMap.name && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-500 mb-1">Preview (first 3 rows):</p>
                <table className="text-xs w-full border rounded-lg overflow-hidden">
                  <thead className="bg-gray-50"><tr>
                    {["Name", "Category", "Type", "Qty", "Unit", "Location"].map((h) => <th key={h} className="px-2 py-1.5 text-left text-gray-500">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {importRows.slice(0, 3).map((row, i) => (
                      <tr key={i} className="border-t">
                        {[importMap.name, importMap.cat, importMap.type, importMap.qty, importMap.unit, importMap.loc].map((col, j) => (
                          <td key={j} className="px-2 py-1.5 text-gray-700">{col ? String(row[col] || "") : "-"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-between pt-2">
              <button onClick={() => setImportStep(1)} className="text-sm border rounded-lg px-4 py-2 text-gray-600">← Back</button>
              <button onClick={() => setImportStep(3)} disabled={!importMap.name} className="bg-indigo-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm">Next →</button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {importStep === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-gray-600">Import mode:</p>
              {[["both", "Update + Add New"], ["update", "Update Existing Only"], ["add", "Add New Only"]].map(([v, l]) => (
                <button key={v} onClick={() => setImportMode(v)}
                  className={"px-3 py-1.5 rounded-lg text-sm border " + (importMode === v ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-200 text-gray-600")}>
                  {l}
                </button>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {importRows.map((row, i) => {
                const name = String(row[importMap.name] || "").trim();
                const existing = inventory.find((inv) => inv.name.toLowerCase() === name.toLowerCase());
                const isNew = !existing;
                const qty = parseInt(row[importMap.qty] || 0) || 0;
                return (
                  <label key={i} className="flex items-center gap-3 bg-white border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={!!importChecked[i]} onChange={(e) => setImportChecked((c) => ({ ...c, [i]: e.target.checked }))} />
                    <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (isNew ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700")}>{isNew ? "🆕 New" : "✅ Match"}</span>
                    <span className="text-sm text-gray-800 flex-1">{name || "(no name)"}</span>
                    <span className="text-xs text-gray-500">qty: {qty}</span>
                    {existing && <span className="text-xs text-gray-400">current: {existing.qty}</span>}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-gray-500">{Object.values(importChecked).filter(Boolean).length} of {importRows.length} rows selected</p>
            <div className="flex justify-between pt-2">
              <button onClick={() => setImportStep(2)} className="text-sm border rounded-lg px-4 py-2 text-gray-600">← Back</button>
              <button onClick={doImport} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm">Import Now →</button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {importStep === 4 && (
          <div className="text-center py-6 space-y-4">
            <p className="text-5xl">✅</p>
            <p className="text-lg font-bold text-gray-900">Import Complete!</p>
            <div className="flex justify-center gap-6">
              {[["🆕 Added", importDone.added, "blue"], ["✅ Updated", importDone.updated, "green"], ["⏭ Skipped", importDone.skipped, "gray"]].map(([l, v, c]) => (
                <div key={l} className="text-center">
                  <p className={`text-3xl font-bold text-${c}-600`}>{v}</p>
                  <p className="text-xs text-gray-500 mt-1">{l}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setImportModal(false)} className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm">Done</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
