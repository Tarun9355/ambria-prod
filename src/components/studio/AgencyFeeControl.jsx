import { useEffect, useRef, useState } from "react";
import { AGENCY_FEE_MAX, clampAgencyFeePct } from "../../lib/studio/agencyFee";

// A small icon for Event Information's dark sidebar: opens a panel where the salesperson sets THIS deal's agency
// (Design & Management) fee — 0 to 25% — instead of the house rate from IMS. Whatever is set is the fee for every
// function of the deal, on every screen.
//
//   value      this deal's own %, or null when it follows the house rate
//   housePct   the house rate (IMS → Admin → Settings), shown so "reset" says what it goes back to
//   onChange   (pct | null) — null = back to the house rate
//   locked     the deal is booked; the fee can still be read but not changed (a booked deal's total moves only through Apply Changes)
const PRESETS = [0, 5, 10, 15, 20, 25];

export default function AgencyFeeControl({ value, housePct, onChange, locked = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const wrap = useRef(null);
  const own = value !== null && value !== undefined;
  const shown = own ? value : housePct;

  // Close on an outside press or Escape; reopen with the current value in the box.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = () => { setNote(""); setText(own ? String(value) : ""); setOpen((o) => !o); };

  const apply = (raw) => {
    const n = Number(raw);
    const clamped = clampAgencyFeePct(raw);
    if (clamped === null) { setNote(`Enter a number from 0 to ${AGENCY_FEE_MAX}.`); return; }
    setNote(Number.isFinite(n) && n > AGENCY_FEE_MAX ? `Highest allowed is ${AGENCY_FEE_MAX}% — set to ${AGENCY_FEE_MAX}%.` : "");
    setText(String(clamped));
    onChange(clamped);
  };

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={`Agency fee: ${shown}%${own ? " (set for this deal)" : " (house rate)"}`}
        title={`Agency fee ${shown}%${own ? " — set for this deal" : " — house rate"}`}
        className={"relative inline-flex items-center justify-center w-[34px] h-[34px] rounded-[10px] transition-colors cursor-pointer " + (open ? "bg-white/[0.16] text-white" : "bg-white/[0.06] text-gray-300 hover:text-white hover:bg-white/[0.12]")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
        </svg>
        {own && <span className="absolute -top-1.5 -right-2 min-w-[22px] px-1 rounded-full bg-[#C9A96E] text-[#1a1530] text-[9.5px] font-bold leading-[15px] text-center">{value}%</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Agency fee for this deal"
          className="absolute left-0 top-[42px] w-[280px] max-w-[calc(100vw-44px)] rounded-xl bg-[#1a1530] text-gray-100 ring-1 ring-white/15 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.65)] p-3.5 z-20">
          <div className="text-[13px] font-semibold">Agency fee</div>
          <p className="text-[11px] leading-snug text-gray-400 mt-0.5">
            Design &amp; Management fee for <b className="text-gray-200">this whole deal</b> — every function. Up to {AGENCY_FEE_MAX}%.
          </p>

          {locked ? (
            <div className="mt-3 rounded-lg bg-white/[0.06] px-2.5 py-2 text-[11.5px] text-gray-300">
              This deal is booked, so the fee is locked at <b className="text-white">{shown}%</b>. Change it through Apply Changes.
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Quick values">
                {PRESETS.map((p) => (
                  <button key={p} type="button" onClick={() => apply(p)} aria-pressed={own && value === p}
                    className={"px-2 py-1 rounded-full text-[12px] font-semibold cursor-pointer transition-colors " + (own && value === p ? "bg-[#C9A96E] text-[#1a1530]" : "bg-white/[0.08] text-gray-200 hover:bg-white/[0.16]")}>
                    {p}%
                  </button>
                ))}
              </div>

              <label className="mt-3 flex items-center gap-2 text-[11px] text-gray-400">
                <span className="shrink-0">Other</span>
                <input type="number" inputMode="decimal" min={0} max={AGENCY_FEE_MAX} step="0.5" value={text} placeholder={String(housePct)}
                  onChange={(e) => { setText(e.target.value); setNote(""); }}
                  onBlur={() => { if (text.trim() !== "" && String(own ? value : "") !== text.trim()) apply(text); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(text); } }}
                  className="w-20 h-8 rounded-lg bg-white/[0.08] border border-white/15 px-2 text-[13px] text-white! text-center outline-none focus:border-[#C9A96E]" />
                <span>%</span>
              </label>
              {note && <div className="mt-1.5 text-[11px] text-amber-300" role="status">{note}</div>}

              <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                {own
                  ? <><span>This deal: <b className="text-white">{value}%</b></span>
                      <button type="button" onClick={() => { setText(""); setNote(""); onChange(null); }} className="text-[#C9A96E] hover:text-white font-semibold cursor-pointer">Use house rate ({housePct}%)</button></>
                  : <span>Using the house rate: <b className="text-white">{housePct}%</b></span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
