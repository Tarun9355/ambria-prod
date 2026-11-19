import { describe, it, expect } from "vitest";
import { trussDiagramSvg } from "./trussDiagramSvg";

// Shapes match what buildTopology (trussEngine) emits per side.
const boxBeams = (lBays, wBays) => [
  ...lBays.map((len, i) => ({ side: lBays.length === 1 ? "front" : `front-${i + 1}`, lengthFt: len })),
  ...lBays.map((len, i) => ({ side: lBays.length === 1 ? "back" : `back-${i + 1}`, lengthFt: len })),
  ...wBays.map((len, i) => ({ side: wBays.length === 1 ? "left" : `left-${i + 1}`, lengthFt: len })),
  ...wBays.map((len, i) => ({ side: wBays.length === 1 ? "right" : `right-${i + 1}`, lengthFt: len })),
];
const lineBeams = (bays) => bays.map((len, i) => ({ side: bays.length === 1 ? "top" : `top-${i + 1}`, lengthFt: len }));

// scaleTopologyForQty builds a Truss Qty of n by pushing the SAME pieces n times.
const qtyOf = (beams, n) => { const out = []; for (let i = 0; i < n; i++) out.push(...beams); return out; };

const box = (l, w, n = 1) => ({ beams: qtyOf(boxBeams(l, w), n) });
const lineT = (b, n = 1) => ({ beams: qtyOf(lineBeams(b), n) });

const pillars = (svg) => (svg.match(/<rect /g) || []).length;
const figures = (svg) => [...svg.matchAll(/>([\d.]+)</g)].map((m) => m[1]);

describe("trussDiagramSvg", () => {
  it("draws a pillar per grid node of a full box", () => {
    expect(pillars(trussDiagramSvg(box([12, 10, 12], [10])).svg)).toBe(8); // 4 cols x 2 rows
  });

  it("draws one row for a single-line truss", () => {
    expect(pillars(trussDiagramSvg(lineT([12, 10])).svg)).toBe(3);
  });

  it("prints every span figure", () => {
    const { svg } = trussDiagramSvg(box([12, 10, 12], [10]));
    expect(figures(svg)).toEqual(expect.arrayContaining(["12", "10"]));
  });

  // Everything the drawing says, as the reader sees it. Tested against the TEXT, never the raw
  // markup: `svg.includes('9"')` also matches a coordinate like y="19", which is how an earlier
  // version of this very check reported a pillar-width label that was not there.
  const says = (svg) => [...svg.matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).filter(Boolean);

  // The pillar's 0.75 ft width is the same on every pillar of every zone, so it is not drawn:
  // it told the crew nothing and crowded the figures that do change (owner call, 2026-11-19).
  it("draws no pillar-width figure and no end stub", () => {
    [trussDiagramSvg(lineT([12, 10])), trussDiagramSvg(box([12, 10], [10]))].forEach(({ svg }) => {
      expect(says(svg)).not.toContain('9"');
      expect(svg).not.toContain("stroke-dasharray");
    });
  });

  // Nothing on the drawing is a word, so the Hindi book needs no translator passed in.
  it("puts no prose on the drawing", () => {
    says(trussDiagramSvg(box([12, 10], [10], 3)).svg).forEach((word) => expect(word).toMatch(/^[\d.…]+$/));
  });

  // ── A bay is drawn as the stock pieces it is really built from ──
  // A 22 ft run between two pillars is a 12 and a 10 joined — which is what the cut list beside the
  // plan says. Drawn as one "22" the crew had to work back from that list to find the joint.
  describe("pieces and joints", () => {
    // stands in for trussEngine's resolveBeamSegment
    const stock = (n) => ({ 22: [12, 10], 26: [12, 12, 2], 24: [12, 12], 20: [10, 10] }[n] || [n]);

    it("splits a bay into its pieces, each with its own length", () => {
      const { svg } = trussDiagramSvg(lineT([22]), { resolveBay: stock });
      expect(figures(svg)).toEqual(["12", "10"]);
      expect(figures(svg)).not.toContain("22");
    });

    it("leaves the joint between pieces open, and does not make it a pillar", () => {
      const { svg } = trussDiagramSvg(lineT([22]), { resolveBay: stock });
      expect(pillars(svg)).toBe(2); // a bay's two ends; the joint is not one
      // two drawn runs, so there is a gap between them rather than one unbroken line
      const runs = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="\2"/g)];
      expect(runs.length).toBeGreaterThanOrEqual(2);
    });

    it("handles a three-piece bay", () => {
      expect(figures(trussDiagramSvg(lineT([26]), { resolveBay: stock }).svg)).toEqual(["12", "12", "2"]);
    });

    it("splits both axes of a box", () => {
      const { svg } = trussDiagramSvg(box([24], [20]), { resolveBay: stock });
      // across (W) 20 -> 10 + 10, down (D) 24 -> 12 + 12
      expect(figures(svg)).toEqual(expect.arrayContaining(["10", "12"]));
      expect(figures(svg)).not.toContain("24");
      expect(figures(svg)).not.toContain("20");
    });

    it("draws the bay whole when no stock size can make it", () => {
      const { svg } = trussDiagramSvg(lineT([7]), { resolveBay: () => [] });
      expect(figures(svg)).toEqual(["7"]); // the cut list is what flags it as not in stock
    });

    it("draws the bay whole with no resolver at all", () => {
      expect(figures(trussDiagramSvg(lineT([22])).svg)).toEqual(["22"]);
    });
  });

  // ── Truss Qty is a REPEAT of the frame, never a longer run ──
  describe("Truss Qty", () => {
    it("reads repeated pieces as separate trusses, not extra bays", () => {
      // A Single U x5 arrives as five identical `top` beams. Read naively that is a 5-bay run of
      // 6 pillars; the truth is five 1-bay frames of 2 pillars each.
      const d = trussDiagramSvg(lineT([10], 5));
      expect(d.qty).toBe(5);
      expect(pillars(d.svg)).toBe(10);
      expect(pillars(d.svg)).not.toBe(6);
    });

    it("reports qty 1 for a genuine multi-bay run", () => {
      const d = trussDiagramSvg(lineT([12, 10, 12, 10]));
      expect(d.qty).toBe(1);
      expect(pillars(d.svg)).toBe(5); // one run of 4 bays
    });

    it("repeats a full box without merging it into one frame", () => {
      const one = trussDiagramSvg(box([12, 10], [10]));
      const three = trussDiagramSvg(box([12, 10], [10], 3));
      expect(three.qty).toBe(3);
      expect(pillars(three.svg)).toBe(pillars(one.svg) * 3);
    });

    it("clips the tail rather than drawing repeats too small to read", () => {
      const many = trussDiagramSvg(lineT([10], 40));
      expect(many.qty).toBe(40);                     // the count still tells the truth
      expect(pillars(many.svg)).toBeLessThan(80);    // but not every frame is drawn
      expect(many.svg).toContain("…");
    });
  });

  // ── The figure across the top must be the "W" the zone's own chip names ──
  // deptBookHtml builds that chip as W = physicalW, D = physicalL for a box, but as W = physicalL
  // for a single U (which has no depth). Drawn the other way round, the Centre Lounge of the
  // 2026-11-19 book printed 24 across the top under a chip reading "W 42.25 × D 25.5".
  describe("orientation", () => {
    const topRow = (svg) => {
      const all = [...svg.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>([\d.]+)</g)].map((m) => ({ y: +m[1], v: +m[2] }));
      const top = Math.min(...all.map((t) => t.y));
      return all.filter((t) => t.y === top).map((t) => t.v);
    };
    // physical = bays + one pillar width per pillar (buildTopology step 3)
    const physical = (bays) => bays.reduce((s, v) => s + v, 0) + (bays.length + 1) * 0.75;

    it("puts a box's W across the page, not its D", () => {
      // Centre Lounge: L-axis one 24 bay (physicalL 25.5 = D), W-axis two 20 bays (physicalW 42.25 = W)
      const { svg } = trussDiagramSvg({
        beams: [
          { side: "front", lengthFt: 24 }, { side: "back", lengthFt: 24 },
          { side: "left-1", lengthFt: 20 }, { side: "left-2", lengthFt: 20 },
          { side: "right-1", lengthFt: 20 }, { side: "right-2", lengthFt: 20 },
        ],
      });
      expect(physical(topRow(svg))).toBeCloseTo(42.25, 2);
    });

    it("puts a single U's one axis across the page", () => {
      // Side Lounge: a 22 ft bay under a chip reading "W 23.5"
      expect(physical(topRow(trussDiagramSvg(lineT([22])).svg))).toBeCloseTo(23.5, 2);
    });

    it("keeps every pillar of the box through the swap", () => {
      const d = trussDiagramSvg(box([24], [20, 20]));
      expect(pillars(d.svg)).toBe(6); // 2 along L x 3 along W, however it is turned
    });
  });

  // The book's column, measured in a browser against the .ztd CSS: 706 page - 2 border - 24 padding.
  const COLUMN = 680;
  const drawn = (d) => ({
    w: Number(d.svg.match(/width="(\d+)"/)[1]),
    h: Number(d.svg.match(/height="(\d+)"/)[1]),
  });

  it("leaves a row that already fits at its drawn height", () => {
    const d = trussDiagramSvg(box([12, 10, 12], [10]));
    const { w, h } = drawn(d);
    expect(w).toBeLessThanOrEqual(COLUMN);
    expect(d.heightPx).toBe(h);
  });

  // A row too long for the column is shrunk by max-width and height:auto takes the height with it,
  // so the book has to reserve the SHRUNK height. Reserving the drawn one leaves a band of white;
  // reserving a half-pixel under what renders runs the zone page past its sheet, hence the ceil.
  it("never reserves less than a row renders at, however long", () => {
    [1, 3, 8, 14, 25, 40].forEach((bays) => {
      [1, 2, 5, 12].forEach((n) => {
        [[10], []].forEach((w) => {
          const t = w.length ? box(Array(bays).fill(10), w, n) : lineT(Array(bays).fill(10), n);
          const d = trussDiagramSvg(t);
          const g = drawn(d);
          expect(d.heightPx).toBeGreaterThanOrEqual(g.h * Math.min(1, COLUMN / g.w));
        });
      });
    });
  });

  // deptBookPdf shrinks an over-tall zone section as ONE image, so an uncapped plan on a
  // three-truss zone does not win itself room — it shrinks the cut list's figures alongside it.
  describe("height cap", () => {
    it("scales the plan down rather than cropping it", () => {
      const full = trussDiagramSvg(box([12, 10, 12], [10]));
      const capped = trussDiagramSvg(box([12, 10, 12], [10]), { maxHeightPx: 100 });
      expect(capped.heightPx).toBeLessThanOrEqual(100);
      expect(capped.heightPx).toBeLessThan(full.heightPx);
      // same drawing, same pillars — scaled, not cropped
      expect(pillars(capped.svg)).toBe(pillars(full.svg));
      expect(capped.svg).toContain(full.svg.match(/viewBox="([^"]+)"/)[1]);
    });

    it("leaves a plan already under the cap alone", () => {
      const flat = trussDiagramSvg(lineT([12, 10]));
      const capped = trussDiagramSvg(lineT([12, 10]), { maxHeightPx: 300 });
      expect(capped.heightPx).toBe(flat.heightPx);
    });

    it("still reserves what a capped plan renders at", () => {
      [50, 80, 100, 150].forEach((cap) => {
        const d = trussDiagramSvg(box(Array(14).fill(10), [10, 10]), { maxHeightPx: cap });
        const w = Number(d.svg.match(/width="(\d+)"/)[1]);
        const h = Number(d.svg.match(/height="(\d+)"/)[1]);
        expect(h).toBeLessThanOrEqual(cap);
        expect(d.heightPx).toBeGreaterThanOrEqual(h * Math.min(1, COLUMN / w));
      });
    });
  });

  it("returns null when there is no bay to draw", () => {
    expect(trussDiagramSvg(null)).toBeNull();
    expect(trussDiagramSvg({ beams: [] })).toBeNull();
    expect(trussDiagramSvg({ beams: [{ side: "cross-NS1", lengthFt: 10 }] })).toBeNull();
  });
});
