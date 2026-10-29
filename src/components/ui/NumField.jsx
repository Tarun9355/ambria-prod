import { useState, useRef, useEffect } from "react";

// ═══ NUMERIC INPUT THAT ACTUALLY LETS YOU RETYPE IT ═══
// A plain controlled <input type="number"> re-renders its DOM value from whatever the last commit
// was on every keystroke. Two things break as a result: (1) clearing the field and typing a fresh
// number — onChange's own `parseInt(v)||0` fallback commits 0 the instant it's blank, the field
// re-renders showing "0" (or snaps back to a min), and the next keystroke lands after a digit that
// was never actually cleared; (2) typing a decimal at all — "2." parses to 2, which re-renders the
// DOM value back to "2" and erases the "." the user just typed, so "2.5" can never be finished.
// This keeps whatever the user is actively typing on screen (including "", "-", a trailing ".")
// until it blurs, and only resyncs to the real committed value then — exactly how every plain text
// field already behaves. onCommit still fires on every keystroke that parses to a real number, so
// existing guards (paint allocation, etc.) run exactly where they used to.
// commitOn="blur": nothing is committed while typing — the number is applied on Enter or when the box is left
// (Escape puts the old value back). Used for a quantity, where "4" and "40" on the way to "400" must never
// become the deal's quantity, and the box must never show a number the deal does not hold. Ctrl+Z then only
// steps through what is being typed, never through quantities that were already applied.
export default function NumField({ value, onCommit, min = 0, allowDecimal = true, commitOn = "keystroke", blankCommit = false, onFocus, onBlur, ...rest }) {
  const [text, setText] = useState(() => (value === null || value === undefined ? "" : String(value)));
  const editingRef = useRef(false);
  useEffect(() => { if (!editingRef.current) setText(value === null || value === undefined ? "" : String(value)); }, [value]);
  const re = allowDecimal ? /^-?\d*\.?\d*$/ : /^-?\d*$/;
  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={text}
      onFocus={(e) => { editingRef.current = true; onFocus?.(e); }}
      onKeyDown={commitOn === "blur" ? (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); setText(value === null || value === undefined ? "" : String(value)); editingRef.current = false; e.currentTarget.blur(); }
      } : undefined}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && raw !== "-" && !re.test(raw)) return; // reject a keystroke that isn't a valid numeric prefix
        const prevText = text;
        setText(raw);
        if (commitOn === "blur") return; // applied when the box is left
        const n = parseFloat(raw);
        // A commit handler may refuse the value by returning false (e.g. more carpet than is in
        // stock): the field goes back to what it showed, so the screen never holds an unsaved number.
        if (!Number.isNaN(n) && onCommit(Math.max(min, n)) === false) setText(prevText);
      }}
      onBlur={(e) => {
        const wasEditing = editingRef.current;
        editingRef.current = false;
        // blankCommit: a field left empty on blur commits `min` instead of snapping back to
        // whatever it held before — lets a value actually be cleared via backspace rather than
        // the backspace getting silently undone the moment the field loses focus.
        if (wasEditing && text === "" && blankCommit) {
          onCommit(min);
        } else if (commitOn === "blur" && wasEditing) {
          const n = parseFloat(text);
          if (!Number.isNaN(n) && Math.max(min, n) !== Number(value)) onCommit(Math.max(min, n));
        }
        setText(value === null || value === undefined ? "" : String(value));
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}
