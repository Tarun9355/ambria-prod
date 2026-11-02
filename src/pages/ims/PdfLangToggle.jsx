// The Dept Ops PDF's language: a two-option segmented toggle, "EN | हिं" (owner ask 2026-11-01). Sits right before the
// Download PDF button on desktop and with the PDF icons on a phone; the choice is DepartmentOpsTab's pdfLang, which also turns the
// Dept Ops screen itself Hindi (lib/ims/useHindiDom). data-no-hi: the toggle's own "EN" is never turned.
const OPTIONS = [["en", "EN", "English"], ["hi", "हिं", "Hindi"]];

// display: the root's display classes (e.g. "hidden sm:inline-flex"), so a caller can hide it at a breakpoint.
export default function PdfLangToggle({ value, onChange, disabled = false, compact = false, display = "inline-flex", className = "" }) {
  return (
    <div data-no-hi role="group" aria-label="Language - screen and PDF" title="Language - screen and PDF"
      className={display + " shrink-0 items-center gap-0.5 p-0.5 rounded-lg bg-gray-100 " + className}>
      {OPTIONS.map(([k, label, name]) => {
        const on = value === k;
        return (
          <button key={k} type="button" onClick={() => onChange(k)} disabled={disabled} aria-pressed={on}
            aria-label={`${name} - screen and PDF`}
            className={(compact ? "h-6 px-2 text-[12px] " : "h-7 px-2.5 text-sm ")
              + "inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap cursor-pointer transition-colors "
              + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 "
              + "disabled:cursor-not-allowed disabled:opacity-60 "
              + (on ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "text-gray-500 hover:text-gray-900 hover:bg-white")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
