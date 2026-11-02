// Skeleton placeholders — the shape of what is loading, shown in its place, so a wait reads as "this is coming" and the
// page fills in instead of jumping from a "Loading…" line to the real layout (owner ask 2026-11-02: skeletons wherever
// Studio takes time). One neutral grey shimmer that reads on the light and the dark theme alike; still for anyone who
// asked their system for reduced motion. Deal Check keeps its own .dc-sk (same look) inside its overlay.
const SK_CSS = `@keyframes skShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
.sk{display:block;background:linear-gradient(90deg,rgba(128,128,140,0.12) 25%,rgba(128,128,140,0.22) 37%,rgba(128,128,140,0.12) 63%);background-size:200% 100%;animation:skShimmer 1.3s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.sk{animation:none}}
.sk-rail{display:flex}@media (max-width:640px){.sk-rail{display:none!important}}`;

/** The shimmer's stylesheet. Render it once in any tree that shows a skeleton (a repeat is harmless). */
export function SkStyle() {
  return <style>{SK_CSS}</style>;
}

/** One bar / block. */
export function Sk({ w = "100%", h = 10, r = 6, style }) {
  return <span className="sk" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />;
}

/** A grid of photo tiles with a caption line, for image / video grids. */
export function SkTiles({ n = 8, min = 140, ratio = "4 / 3", caption = true, label = "Loading" }) {
  return (
    <div role={label ? "status" : undefined} aria-label={label || undefined} style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${min}px,1fr))`, gap: 10 }}>
      <SkStyle />
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Sk h="auto" r={8} style={{ aspectRatio: ratio, width: "100%" }} />
          {caption && <Sk w={`${55 + ((i * 17) % 35)}%`} h={9} />}
        </div>
      ))}
    </div>
  );
}

/** List rows: an optional thumbnail, a title line and a detail line, and a figure on the right. */
export function SkRows({ n = 5, thumb = true, figure = true, label = "Loading" }) {
  return (
    <div role="status" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SkStyle />
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {thumb && <Sk w={36} h={36} r={7} />}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <Sk w={`${50 + ((i * 23) % 40)}%`} h={11} />
            <Sk w={`${30 + ((i * 13) % 25)}%`} h={9} />
          </div>
          {figure && <Sk w={54} h={12} />}
        </div>
      ))}
    </div>
  );
}

/** A whole page: a top bar, then a column of cards — for the first load of a section. */
export function SkPage({ label = "Loading" }) {
  const card = { border: "1px solid rgba(128,128,140,0.14)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12 };
  return (
    <div role="status" aria-label={label} style={{ minHeight: "100vh", background: "#FAF9F6", display: "flex", flexDirection: "column" }}>
      <SkStyle />
      <div style={{ height: 56, borderBottom: "1px solid rgba(128,128,140,0.14)", display: "flex", alignItems: "center", gap: 14, padding: "0 20px" }}>
        <Sk w={96} h={18} />
        <div style={{ flex: 1 }} />
        <Sk w={70} h={26} r={999} /><Sk w={70} h={26} r={999} /><Sk w={30} h={30} r={999} />
      </div>
      <div style={{ width: "100%", maxWidth: 1200, margin: "0 auto", padding: "22px 20px", display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" }}>
        <Sk w={220} h={20} />
        {[0, 1].map((c) => (
          <div key={c} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Sk w={140} h={14} /><div style={{ flex: 1 }} /><Sk w={80} h={20} r={999} /></div>
            <SkTiles n={c === 0 ? 4 : 3} min={200} caption={false} label="" />
          </div>
        ))}
      </div>
    </div>
  );
}
