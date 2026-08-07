# Deal Check — Pricing Logic Test Cases

Purpose: pin down where Deal Check's numbers come from, and give a repeatable way to catch pricing
errors. Written against the code as of 7 Aug 2026.

Two findings below are **confirmed bugs in the source** (§2.1, §2.2). Everything else is a test to
run — some will pass, and the ones that fail tell you where the next bug is.

---

## 1. How pricing is structured

There are **two independent money paths**, and confusing them is the single biggest source of
"the numbers don't match" reports.

| | Quote side (what the client pays) | Cost side (what it costs us) |
|---|---|---|
| Lives in | `StudioApp.calcStructCost`, `calcFunctionCost` | `DealCheckOverlay.dcCostRollup` |
| Platform | `area × platformRateFor(plH)` — a ₹/sqft sell rate | Fatta + Stand component rental from IMS |
| Carpet | `area × carpetPricingFor(cpT).rate` | `calcZoneCarpet` — reused rental + fresh purchase |
| Shown as | Build "Live Estimate", Summary | Deal Check "PROJECT TOTAL" |

**They are supposed to differ.** In the reference screenshots a 30×30 platform quotes ₹18,000
(900 sqft × ₹20) and costs ₹12,490 (Fatta ₹320×32 + Stand ₹50×45). That is margin, not a bug.

`profitPct = (clientRevenue − effGrand) / clientRevenue`, where `clientRevenue` is the sum of
`calcFunctionCost(fn).grand` over functions — i.e. the quote side. A large negative margin means
the cost side exceeds the quote, not that a formula is broken.

### Cost rollup shape (`DealCheckOverlay.jsx:692`)

```
base       = rental + florals + transport + manpower + truss + buyTotal + produceTotal
gyvFixed   = round(base × 0.05)
bufferCost = round(base × 0.03)
grand      = base + round(base × 0.05) + round(base × 0.03)
```

**Verified, not a bug:** `genset` is accumulated separately for display but is already inside
`transport` — `transportTotal = truckTotal + gensetCost` (`StudioApp.jsx:3774`). `base` therefore
neither omits nor double-counts it. Do not "fix" this.

---

## 2. Confirmed bugs

### 2.1 Fresh carpet is priced at zero — `pricing.js:595` 🔴

```js
const freshCost = fresh * purchaseRate * ((Number(markupPct) || 0) / 100);
```

The markup multiplier has no base. Consequences:

| markupPct | Intended | Actual |
|---|---|---|
| 0 | cost price | **₹0 — free** |
| 20 | cost + 20% | 20% *of* cost |
| 100 | cost + 100% | exactly cost price |

Almost certainly meant to be `purchaseRate * (1 + markupPct / 100)`.

**Reproduces in the screenshot:** `42 reused + 858 fresh sqft · ₹16,800 (incl. ₹0 fresh)`. The
₹16,800 is entirely the 42 reused sqft × ₹400 rental; 858 sqft of fresh carpet was costed at zero.

**Test:** zone 30×30 (900 sqft), carpet item with `qtyOwned = 42`, `cost = ₹120`, `markupPct = 0`.
- Expect: fresh 858 × 120 = ₹1,02,960 → total ₹1,19,760
- Actual: ₹0 fresh → total ₹16,800
- **Understates cost by ₹1.03 lakh on one zone.**

### 2.2 Carpet dropdown resolves against the wrong material list — `StudioBuild.jsx:2656` 🟠

```js
<select value={zc.cpT || defaultCarpetMatId(imsPrintMaterials) || ""}>
```

Five other call sites pass `imsCarpetMaterials`; this one passes **print** materials. When `zc.cpT`
is unset the dropdown resolves its default against the wrong list while the cost path
(`platformRowCost` → `carpetPricingFor(row.cpT, rates.carpetMaterials)`) uses the right one.

**Symptom:** the select displays one material (or blank) while the charged rate is another's.

**Test:** new zone, never touch the carpet select. Compare the displayed material's ₹/sqft against
`carpet cost ÷ floor area`. They should be equal.

### 2.3 `gyvFixed` / `grand` disagree once actuals exist — `DealCheckOverlay.jsx:694-696` 🟡

`gyvFixed` and `bufferCost` switch to `baseActual` when `hasActuals`, but `grand` recomputes
`base × 0.05` inline instead of reusing them. `grandActual` uses the variables, so the two totals
apply different 5%/3% bases. Only `effGrand` is displayed, so this may be latent — worth a test
before someone surfaces `grand` directly.

### 2.4 Zero revenue reports 0% margin, not a loss — `DealCheckOverlay.jsx:701` 🟡

`clientRevenue > 0 ? … : 0`. A deal with real costs and no quote shows **0%**, which reads as
break-even rather than "total loss". Consider `null` and rendering "—".

---

## 3. Test cases

Fill in Actual and mark P/F. Anything failing that isn't §2 is a new bug.

### A. Platform components (`computePlatformComponents`)

Recipe: 1 fatta = 8×4 ft; stands at grid corners; `4in` ⇒ stands = 0. Picks the orientation with
fewer stands.

| # | L×W | plH | Expected fattas | Expected stands | Actual | P/F |
|---|---|---|---|---|---|---|
| A1 | 30×30 | 1ft | 32 | 45 | | |
| A2 | 30×30 | 4in | 32 | **0** | | |
| A3 | 8×4 | 1ft | 1 | 4 | | |
| A4 | 8.1×4 | 1ft | 2 | 6 | | |
| A5 | 0×30 | 1ft | `null` | `null` | | |
| A6 | −5×10 | 1ft | `null` | `null` | | |
| A7 | 100×100 | 1ft | check both orientations agree with the tie-break | | | |

A1 matches the screenshot (32 / 45) — use it as the anchor.

### B. Carpet (`calcZoneCarpet`) — **§2.1 lives here**

Item: `qtyOwned = 42`, `rentalCost = ₹400`, `cost = ₹120`.

| # | Area | markupPct | Expected reused | Expected fresh ₹ | Actual | P/F |
|---|---|---|---|---|---|---|
| B1 | 900 | 0 | 42 × 400 = ₹16,800 | 858 × 120 = ₹1,02,960 | ₹0 🔴 | F |
| B2 | 900 | 20 | ₹16,800 | 858 × 120 × 1.2 = ₹1,23,552 | | |
| B3 | 40 | 0 | 40 × 400 = ₹16,000 | ₹0 (none fresh) | | |
| B4 | 0 | 0 | ₹0 | ₹0 | | |
| B5 | 900, `cpT = CARPET_OFF` | — | ₹0 | ₹0 | | |
| B6 | 900, item missing | — | ₹0 | ₹0 | | |

Also confirm `needed` uses `floorDims` and falls back to `dims` — B7: set `floorDims` only, then
`dims` only, then both differing. The costed area must match the one shown as "L×W = N sqft".

### C. Quote vs cost divergence

| # | Check | Expected |
|---|---|---|
| C1 | 30×30 `1ft` platform | Quote 900 × platform rate; Cost = fatta + stand rental. Both non-zero, quote > cost |
| C2 | Change platform rate in IMS → Master Data | Quote moves, cost does **not** |
| C3 | Change Fatta rental in IMS | Cost moves, quote does **not** |
| C4 | `4in` platform | Cost drops by the full stand line; quote changes only by its own rate |

### D. Rollup arithmetic

| # | Check | Expected |
|---|---|---|
| D1 | `base` | equals the 7 component lines summed, to the rupee |
| D2 | Genset | appears **once** — inside `transport`, not added again (see §1) |
| D3 | GYV 5% / Buffer 3% | equal `round(base × 0.05)` / `round(base × 0.03)` |
| D4 | Log an actual mandi figure | `gyvFixed` and `bufferCost` switch to `baseActual`; check `grand` vs `grandActual` (§2.3) |
| D5 | Zero-quote deal | margin should not read 0% (§2.4) |
| D6 | Two functions | project total = sum of both, no shared cost counted twice |

### E. Multi-zone / multi-function

| # | Check | Why it matters |
|---|---|---|
| E1 | Same carpet item across 3 zones | `qtyOwned` must not be spent 3× — each zone claiming the same 42 reused sqft understates cost |
| E2 | Platform stock across zones on one date | Screenshot shows "0 free (after 74 taken by prior zones this date)" — confirm the running total is per date, not per deal |
| E3 | Extra platform rows | Each row's own `cpT` is costed, not row 0's |
| E4 | Extra truss rows | Each row's own material and density |

**E1 is the highest-value untested case here.** `calcZoneCarpet` takes `qtyOwned` straight off the
item with no cross-zone ledger, so N zones can each believe they got the same owned stock.

### F. Rounding

| # | Check | Expected |
|---|---|---|
| F1 | Sum of displayed lines vs displayed total | Differ by < ₹1 |
| F2 | Fractional truck counts | Screenshot showed `0.042666666666666665 trucks` — assert display is rounded, and that rounding happens at display only, never before a multiply |

---

## 4. Suggested order

1. **§2.1** — fix the formula. Largest rupee impact, and it silently *understates* cost, which is
   the dangerous direction.
2. **E1** — cross-zone stock double-claiming, same failure mode, likely same magnitude.
3. **§2.2** — one-word fix, removes a display/charge mismatch.
4. §2.3 / §2.4 — correctness tidy-ups, low user impact today.

## 5. Not yet reviewed

Florals (`calcFnFloralSourcingCost`), manpower (`deptMpReconciled`, `mpRateByType`), truss
(`calcZoneTrussPreview`), fabric allocation (`calcFabricAllocCost`), Buying/Production. Each
deserves its own pass; this document covers structure, platform, carpet and the rollup only.
