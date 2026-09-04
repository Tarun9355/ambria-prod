# Event Info — Manual Test Cases

Step 01 (`StudioEventInfo.jsx`), desktop + tablet. Tick as you go.

**Viewport tags** — `[D]` desktop ≥1201 · `[TL]` tablet landscape 1200–841 · `[TP]` tablet portrait ≤840 · `[N]` narrow ≤640 · `[B]` both/any

Breakpoints below are the file's own: `1200/841`, `840`, `640`, and `pointer:coarse` for touch sizing.

---

## A. Viewport & layout

- [ ] **A1** `[D]` ≥1201 — brand panel full-height left at 560px, form column right
- [ ] **A2** `[TL]` 1200–841 — panel narrows to 340px, gold mark re-centres on the narrower waist
- [ ] **A3** `[TP]` ≤840 — panel becomes a 170px band across the top, curve along its bottom edge
- [ ] **A4** `[TP]` ≤840 — band stays fixed while the form scrolls beneath it
- [ ] **A5** `[TP]` ≤840 — panel shadow, vertical edge trace and embers all hidden
- [ ] **A6** `[TP]` ≤840 — hero face drops to 40px, doesn't overflow its line
- [ ] **A7** `[N]` ≤640 — paired fields unstack to a single column
- [ ] **A8** `[B]` No horizontal page scroll at 1280 / 1024 / 820 / 768 / 744 / 640
- [ ] **A9** `[TP]` Touch — inputs ≥44px at 16px type, so iOS doesn't zoom on focus
- [ ] **A10** `[TP]` Touch — Reset, Collapse, Remove, Edit all ≥34px and tappable first time
- [ ] **A11** `[D]` Touchscreen laptop with trackpad keeps compact desktop controls
- [ ] **A12** `[B]` Reduced motion — no photo drift, candle flicker, shimmer or embers
- [ ] **A13** `[TP]` Rotate portrait ↔ landscape mid-form — every typed value survives
- [ ] **A14** `[B]` Dark mode — no unreadable text on any panel, chip or banner

## B. Guest name, phone & reset

- [ ] **B1** `[B]` Empty name — Continue disabled, "Guest name" listed under Missing
- [ ] **B2** `[B]` Name of spaces only still counts as empty
- [ ] **B3** `[B]` Letters typed into Phone are ignored — digits only
- [ ] **B4** `[B]` Phone stops at 10 digits; an 11th keystroke does nothing
- [ ] **B5** `[B]` 9-digit phone — Continue still blocked, "Phone" under Missing
- [ ] **B6** `[B]` Paste `+91 98765-43210` — reduces to the last 10 digits
- [ ] **B7** `[TP]` Phone field opens the numeric keypad
- [ ] **B8** `[B]` Bride & Groom blank never blocks Continue
- [ ] **B9** `[B]` Reset disabled on a completely untouched form
- [ ] **B10** `[B]` Reset enables once any field is filled, or a client is loaded
- [ ] **B11** `[B]` Reset asks first, then clears every field including extra functions

## C. Rename guard

> Load a saved client first.

- [ ] **C1** `[B]` Editing a loaded client's name raises the amber banner naming the old value
- [ ] **C2** `[B]` Confirm rename — banner clears, new name survives a refresh
- [ ] **C3** `[B]` Revert — original name comes back
- [ ] **C4** `[B]` Edit name → Continue without confirming — name NOT saved, red toast explains
- [ ] **C5** `[B]` That same Continue still saves date, venue, shift, pax normally
- [ ] **C6** `[B]` Editing only the phone raises the same banner
- [ ] **C7** `[B]` Brand-new client — no banner; what you type is the deliberate identity
- [ ] **C8** `[B]` Leave name edited, wait 20s for autosave, refresh — old name still stands

## D. LMS lead suggestions

- [ ] **D1** `[B]` Typing 2+ characters surfaces the green LMS block
- [ ] **D2** `[B]` Lead row shows name, phone, DECOR/VENUE entry no. and priority
- [ ] **D3** `[D]` Costed lead shows its amount on the meta line; hover gives total · decor
- [ ] **D4** `[B]` Uncosted lead shows no ₹0 — the amount is simply absent
- [ ] **D5** `[B]` No payment or balance figure appears anywhere on the lead
- [ ] **D6** `[B]` Multi-function lead shows the FUNCTIONS chip and each date
- [ ] **D7** `[B]` Lead hidden when Studio holds the same phone on the same date
- [ ] **D8** `[B]` Header then reads "N already open in Studio below" — never silently missing
- [ ] **D9** `[B]` A linked lead on a **different** date still appears
- [ ] **D10** `[B]` Same phone, different date — both LMS and Studio rows show
- [ ] **D11** `[B]` Refresh shows "Syncing…" and disables itself until done
- [ ] **D12** `[B]` LMS unreachable — amber note + working Refresh, Studio matches still listed
- [ ] **D13** `[B]` Load → fills name, phone, bride/groom, all functions with dates and venues
- [ ] **D14** `[B]` After Load the client card carries the LMS # tag

## E. Studio client suggestions

- [ ] **E1** `[B]` Matches on 2+ characters of name, or 4+ digits of phone
- [ ] **E2** `[B]` Chips show function, event date and venue after the phone
- [ ] **E3** `[B]` Multi-function deal adds the `+N FN` chip
- [ ] **E4** `[B]` Client with no date or venue renders cleanly — no empty chips
- [ ] **E5** `[TP]` Long venue name wraps instead of pushing Load off the row
- [ ] **E6** `[B]` Two records for one guest — the one holding sessions is the one offered
- [ ] **E7** `[B]` Empty record reads "No sessions saved yet"
- [ ] **E8** `[B]` Meta line shows session count, who saved last, how long ago, and the total
- [ ] **E9** `[B]` Show mine only / Show all toggles a colleague's clients in and out
- [ ] **E10** `[B]` All matches owned by others — "tagged to other salespeople" + Show all button
- [ ] **E11** `[B]` No match at all — "No matching LMS lead or Studio client"
- [ ] **E12** `[B]` Load → restores the deal and lands on its saved step

## F. Function 1 gate

- [ ] **F1** `[B]` Event Type blank blocks Continue
- [ ] **F2** `[B]` Event Date blank blocks Continue
- [ ] **F3** `[B]` Venue blank blocks Continue
- [ ] **F4** `[B]` Shift blank blocks Continue
- [ ] **F5** `[B]` Pax blank never blocks Continue
- [ ] **F6** `[B]` Missing list names exactly the blank fields, nothing more
- [ ] **F7** `[B]` Filling the last one flips status to "All required details captured"
- [ ] **F8** `[B]` A past event date is accepted without complaint
- [ ] **F9** `[TP]` Date picker opens natively and returns the right day
- [ ] **F10** `[B]` Negative or zero pax is rejected or coerced, never saved as-is

## G. Venue & the Others path

- [ ] **G1** `[B]` In-house venues grouped under their property
- [ ] **G2** `[B]` Empanelled and other outside venues in separate groups
- [ ] **G3** `[B]` "Others (type custom)" offered on Function 1 only
- [ ] **G4** `[B]` Choosing Others on Function 2+ is ignored, previous venue intact
- [ ] **G5** `[B]` Others reveals the custom venue name field
- [ ] **G6** `[B]` Others reveals custom trip rate and genset count inputs
- [ ] **G7** `[B]` Custom venue name persists on blur and survives a refresh
- [ ] **G8** `[B]` Switching from Others back to a real venue clears the custom text
- [ ] **G9** `[B]` A custom name matching an existing venue doesn't create a ghost entry

## H. Multiple functions

- [ ] **H1** `[B]` Add Another Function appends a card and expands it
- [ ] **H2** `[B]` New function inherits Function 1's venue as its starting value
- [ ] **H3** `[B]` Only one function expanded at a time; opening one collapses the last
- [ ] **H4** `[B]` A completed function shows type, date, venue and pax when collapsed
- [ ] **H5** `[B]` Remove opens a confirm sheet listing that function's details
- [ ] **H6** `[D]` Cancel holds focus in the confirm sheet, not Remove
- [ ] **H7** `[B]` Removing Function 1 warns the next becomes Function 1 and the build moves with it
- [ ] **H8** `[B]` The last remaining function cannot be removed
- [ ] **H9** `[D]` Escape or an outside click dismisses the sheet with nothing removed
- [ ] **H10** `[B]` Three+ functions each keep their own date, venue and shift
- [ ] **H11** `[B]` Two functions on the same date at the same venue are allowed

## I. Continue & duplicates

- [ ] **I1** `[B]` Continue stays disabled until all six required fields are in
- [ ] **I2** `[D]` Hovering the disabled button names what's still missing
- [ ] **I3** `[B]` Exact duplicate — same phone, venue **and** date — refused with a red toast
- [ ] **I4** `[B]` Same phone, different date — asks first, showing the existing deal's sessions and total
- [ ] **I5** `[B]` Cancel on that prompt keeps you on Event Info with nothing saved
- [ ] **I6** `[B]` Create anyway proceeds, and doesn't ask again for that number
- [ ] **I7** `[B]` Editing a loaded client into a collision is allowed — the guard is create-only
- [ ] **I8** `[B]` Deal with an existing build lands straight on Build, not Browse
- [ ] **I9** `[B]` Deal with no build lands on Browse, filtered to that venue and event type
- [ ] **I10** `[B]` Venue "Others" doesn't seed a venue filter on Browse
- [ ] **I11** `[TP]` Double-tapping Continue doesn't create two clients

## J. Persistence & recovery

> Assumes a deal that has autosaved at least once.

- [ ] **J1** `[B]` Refresh mid-form on a saved deal — client and step come back
- [ ] **J2** `[B]` Refresh on a brand-new unsaved form — blank is correct, nothing to restore
- [ ] **J3** `[B]` Switch to IMS and back — every typed value still there
- [ ] **J4** `[B]` "Update now" banner — the same client comes back, not a blank form
- [ ] **J5** `[B]` Ledger fails to load — warning banner with a working "Retry now"
- [ ] **J6** `[B]` Retry succeeds — suggestions and the loaded deal both return
- [ ] **J7** `[B]` Offline mid-form — no crash, no silent loss on reconnect
- [ ] **J8** `[D]` Two tabs on the same deal — the second doesn't overwrite the first's edits

---

## Cases that verify recent fixes

| Case | Fix |
|---|---|
| C4, C8 | BUG-18 — Continue no longer saves an unconfirmed rename |
| D4, D5 | LMS amount shown, hidden at zero, no balance figure |
| D7–D10 | LMS lead hidden when Studio holds the same phone + date |
| E2–E4 | Event chips on client cards |
| E6, E7 | Record holding work wins over an empty duplicate |
| I3, I4 | Duplicate guard + near-duplicate warning |
| J4 | Possibly fixed via BUG-13 (`switchingRef` release) — unconfirmed |

**Most likely to find something:** E5 (long venue wrapping on tablet) and I11 (double-tap Continue).
