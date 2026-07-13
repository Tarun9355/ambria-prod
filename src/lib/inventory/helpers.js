// ─── Inventory helpers (faithful copies of reference IMS app) ─────────────────
import { DATE_PRICING_LABELS } from "../ims/constants";

// Suggest up to 3 similar in-stock items when a target is low/out of stock.
export function findAlternatives(targetItem, inventory, neededQty = 1, excludeId = null) {
  if (!targetItem) return [];
  const tName = (targetItem.name || "").toLowerCase();
  const tCat = (targetItem.cat || "").toLowerCase();
  const tSubCat = (targetItem.subCat || "").toLowerCase();
  const tWords = tName.split(/\s+/).filter((w) => w.length > 2);

  return inventory
    .filter((i) => {
      if (i.id === excludeId) return false;
      const avail = i.qty - (i.blocked || 0);
      return avail > 0;
    })
    .map((i) => {
      const iName = i.name.toLowerCase();
      const iCat = i.cat.toLowerCase();
      const iSubCat = (i.subCat || "").toLowerCase();
      const avail = i.qty - (i.blocked || 0);
      let score = 0;
      if (tSubCat && iSubCat && iSubCat === tSubCat) score += 60;
      if (iCat === tCat) score += 30;
      const wordHits = tWords.filter((w) => iName.includes(w)).length;
      score += wordHits * 20;
      if (i.type === targetItem.type) score += 10;
      if (avail >= neededQty) score += 15;
      else if (avail > 0) score += 5;
      return { ...i, _score: score, _avail: avail };
    })
    .filter((i) => i._score >= 20)
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);
}

// Effective date-pricing category: manual override (markedDates) wins, else the auto-synced
// LMS category (datePricing.autoCategories, kept in sync from the Calendar's LMS/season data),
// else Filler (non_saya) — the single source of truth every date-pricing consumer should share.
export function resolveDateCategory(dateStr, settings) {
  const dp = settings?.datePricing;
  if (!dateStr || !dp) return "non_saya";
  return (dp.markedDates || {})[dateStr] || (dp.autoCategories || {})[dateStr] || "non_saya";
}

// Dynamic date pricing → { effectivePrice, multiplier, category, label, reason }.
export function getEffectivePricing(basePrice, functionDate, settings) {
  if (!basePrice || !functionDate || !settings?.datePricing)
    return { effectivePrice: basePrice, multiplier: 1, category: "competition", label: "Standard", reason: "No pricing rules" };
  const dp = settings.datePricing;
  const fnDate = new Date(functionDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.ceil((fnDate - today) / 86400000);
  const lastMinDays = dp.lastMinuteDays || 10;
  if (daysUntil >= 0 && daysUntil <= lastMinDays) {
    const cat = dp.categories.non_saya;
    const label = DATE_PRICING_LABELS.non_saya;
    return { effectivePrice: Math.round(basePrice * (cat?.multiplier || 0.75)), multiplier: cat?.multiplier || 0.75, category: "non_saya", label, reason: `Last-minute booking (${daysUntil}d away)` };
  }
  const catKey = resolveDateCategory(functionDate, settings);
  if (catKey && dp.categories[catKey]) {
    const cat = dp.categories[catKey];
    const label = DATE_PRICING_LABELS[catKey] || cat.label;
    const marked = (dp.markedDates || {})[functionDate];
    return { effectivePrice: Math.round(basePrice * cat.multiplier), multiplier: cat.multiplier, category: catKey, label, reason: marked ? `Date marked as ${label}` : `Auto-synced as ${label}` };
  }
  const cat = dp.categories.competition;
  return { effectivePrice: basePrice, multiplier: 1, category: "competition", label: DATE_PRICING_LABELS.competition || cat?.label || "Standard", reason: "Unmarked date (standard pricing)" };
}
