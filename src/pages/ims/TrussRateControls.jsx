import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { RATE_ACTION } from "../../lib/ims/trussRates";

// A truss / fabric rate box (IMS Planning -> Fabric Stock, Truss & Batta Config). Admin only, and it saves once, when the box is
// left or Enter is pressed - it used to save on every keystroke (500 -> 0 -> 1 -> 12 -> 150 -> 1500 ...), which is how a half-typed
// value could stick. Escape puts the saved value back. lib/ims/trussRates for the why.
export function RateInput({ value, canChange, onSave, className, ariaLabel }) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const [busy, setBusy] = useState(false);
  const editing = useRef(false);
  const cancel = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value ?? 0)); }, [value]);
  const commit = async () => {
    editing.current = false;
    if (cancel.current) { cancel.current = false; setDraft(String(value ?? 0)); return; }
    const t = draft.trim();
    const n = t === "" ? 0 : Number(t);
    if (!Number.isFinite(n) || n < 0) { setDraft(String(value ?? 0)); return; }
    if (n === (Number(value) || 0)) { setDraft(String(value ?? 0)); return; }
    setBusy(true);
    const ok = await onSave(n);
    setBusy(false);
    if (!ok) setDraft(String(value ?? 0));
  };
  return (
    <input type="number" min="0" step="1" inputMode="decimal" aria-label={ariaLabel} value={draft}
      disabled={!canChange || busy}
      title={canChange ? "Saved when you leave the box or press Enter · Esc cancels" : "Only an Admin can change a rate"}
      onFocus={() => { editing.current = true; cancel.current = false; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); } }}
      className={className + (canChange ? "" : " bg-gray-50 text-gray-500 cursor-not-allowed")} />
  );
}

export function AdminOnlyNote() {
  return (
    <div className="rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold px-3 py-2 inline-flex items-center gap-1.5">
      <span aria-hidden="true">🔒</span>{"Only an Admin can change rates"}
    </div>
  );
}

const fmtWhen = (iso) => {
  try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return iso || ""; }
};
const rupee = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN");

// Who changed which rate, when, from what to what (newest first) - from the rate log (user_actions). Starts with the first change
// made after this shipped; changes before it were never recorded with a name.
export function RateHistory({ refreshKey = 0, keys = null }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(false);
  // keys arrives as a fresh array each render - depend on its text, or every render would load again
  const keyText = keys ? keys.join(",") : "";
  const load = useCallback(async () => {
    setErr(false);
    const { data, error } = await supabase.from("user_actions").select("id,user_name,target_name,ok,detail,created_at")
      .eq("action", RATE_ACTION).order("created_at", { ascending: false }).limit(60);
    if (error) { setErr(true); setRows([]); return; }
    const only = keyText ? keyText.split(",") : null;
    setRows((data || []).filter((r) => !only || only.includes(r.detail?.key)));
  }, [keyText]);
  useEffect(() => { if (open) load(); }, [open, refreshKey, load]);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors">
        <span className="text-sm font-semibold text-gray-900"><span aria-hidden="true">🕘</span> {"Rate history"}</span>
        <span className="text-xs text-gray-500">{open ? "Hide" : "Who changed which rate, and when"}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          {rows === null ? (
            <div className="px-4 py-3 text-xs text-gray-500">{"Loading…"}</div>
          ) : err ? (
            <div className="px-4 py-3 text-xs text-red-700 flex items-center gap-3">
              <span>{"Couldn't load the history."}</span>
              <button type="button" onClick={load} className="font-semibold underline">{"Retry"}</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-3 text-xs text-gray-500">{"No rate changes recorded yet. Every change from now on shows here with the name of who made it."}</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{r.target_name}</div>
                    <div className="text-xs text-gray-500"><span>{r.user_name || "Unknown"}</span> · <span className="tabular-nums">{fmtWhen(r.created_at)}</span>{r.ok === false && <span className="text-red-600 font-semibold"> · {"not saved"}</span>}</div>
                  </div>
                  <div className="shrink-0 tabular-nums text-gray-700 whitespace-nowrap">
                    <span className="text-gray-400 line-through">{rupee(r.detail?.from)}</span> <span aria-hidden="true">→</span> <b className={Number(r.detail?.to) === 0 ? "text-red-600" : "text-gray-900"}>{rupee(r.detail?.to)}</b>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
