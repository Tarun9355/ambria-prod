import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sk, SkStyle, SkTiles, SkRows, SkPage } from "./Skeleton.jsx";

describe("Skeleton placeholders render", () => {
  it("a bar carries the shimmer class and its size", () => {
    const html = renderToStaticMarkup(<Sk w={64} h={9} r={4} />);
    expect(html).toContain('class="sk"');
    expect(html).toContain("width:64px");
    expect(html).toContain('aria-hidden="true"');
  });
  it("the stylesheet has the shimmer and the reduced-motion stop", () => {
    const html = renderToStaticMarkup(<SkStyle />);
    expect(html).toContain("@keyframes skShimmer");
    expect(html).toContain("prefers-reduced-motion");
  });
  it("tiles: n tiles, a status role with its label, no role when the label is empty", () => {
    const html = renderToStaticMarkup(<SkTiles n={5} label="Loading photos" />);
    expect((html.match(/aspect-ratio/g) || []).length).toBe(5);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading photos"');
    expect(renderToStaticMarkup(<SkTiles n={2} label="" />)).not.toContain('role="status"');
  });
  it("rows: thumbnails and figures can be left out", () => {
    const withAll = renderToStaticMarkup(<SkRows n={3} />);
    const bare = renderToStaticMarkup(<SkRows n={3} thumb={false} figure={false} />);
    expect((withAll.match(/class="sk"/g) || []).length).toBe(12);
    expect((bare.match(/class="sk"/g) || []).length).toBe(6);
  });
  it("the page skeleton renders whole", () => {
    const html = renderToStaticMarkup(<SkPage label="Loading" />);
    expect(html).toContain('aria-label="Loading"');
    expect((html.match(/class="sk"/g) || []).length).toBeGreaterThan(10);
  });
});
