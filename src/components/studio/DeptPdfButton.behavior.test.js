import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═══ Deal Check "All departments PDF" - DeptPdfButton's message handling, run for real ═══
// The repo has no DOM test environment (no jsdom / happy-dom / testing-library), so the component is driven
// through a tiny hooks runtime that stands in for React's useState / useEffect / useRef (mocked below) and
// follows React's ordering that matters here: a state change made inside an event handler is rendered AFTER
// the handler returns, then effects whose deps changed run their cleanup (all of them) and then their body.
// `window`, `document`, `localStorage` and `URL.createObjectURL` are small recording fakes.
const rt = vi.hoisted(() => {
  const s = { inst: null, batch: 0 };
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const flush = () => {
    const inst = s.inst;
    if (!inst || inst.unmounted) return;
    let guard = 0;
    while (inst.dirty && guard++ < 50) {
      inst.dirty = false;
      inst.i = 0;
      inst.queue = [];
      s.cur = inst;
      inst.out = inst.Comp(inst.props);
      s.cur = null;
      const q = inst.queue;
      q.forEach((e) => { if (e.slot.cleanup) { e.slot.cleanup(); e.slot.cleanup = null; } });
      q.forEach((e) => { const c = e.fn(); e.slot.cleanup = typeof c === "function" ? c : null; });
    }
  };
  const mount = (Comp, props) => {
    s.inst = { Comp, props, hooks: [], i: 0, dirty: true, queue: [], out: null, unmounted: false };
    flush();
  };
  const act = (fn) => { s.batch++; try { fn(); } finally { s.batch--; } if (!s.batch) flush(); };
  const useState = (init) => {
    const inst = s.cur;
    const idx = inst.i++;
    if (!inst.hooks[idx]) {
      const slot = { v: typeof init === "function" ? init() : init };
      slot.set = (nv) => {
        const v = typeof nv === "function" ? nv(slot.v) : nv;
        if (Object.is(v, slot.v)) return;
        slot.v = v; inst.dirty = true;
        if (!s.batch) flush();
      };
      inst.hooks[idx] = slot;
    }
    const slot = inst.hooks[idx];
    return [slot.v, slot.set];
  };
  const useRef = (init) => {
    const inst = s.cur;
    const idx = inst.i++;
    if (!inst.hooks[idx]) inst.hooks[idx] = { current: init };
    return inst.hooks[idx];
  };
  const useEffect = (fn, deps) => {
    const inst = s.cur;
    const idx = inst.i++;
    const slot = inst.hooks[idx] || (inst.hooks[idx] = { deps: undefined, cleanup: null, first: true });
    if (slot.first || !deps || !same(slot.deps, deps)) { inst.queue.push({ slot, fn }); }
    slot.first = false; slot.deps = deps;
  };
  const unmount = () => {
    const inst = s.inst;
    inst.hooks.forEach((h) => { if (h && h.cleanup) { h.cleanup(); h.cleanup = null; } });
    inst.unmounted = true;
  };
  return { s, mount, act, flush, unmount, useState, useRef, useEffect };
});

vi.mock("react", async (orig) => {
  const real = await orig();
  return { ...real, useState: rt.useState, useRef: rt.useRef, useEffect: rt.useEffect };
});

import DeptPdfButton from "./DeptPdfButton.jsx";

// ── tree helpers (the component returns plain React elements) ──
const kids = (n) => (n && n.props ? [].concat(n.props.children ?? []) : []);
const walk = (n, fn) => { if (n == null || typeof n === "boolean") return; if (Array.isArray(n)) { n.forEach((c) => walk(c, fn)); return; } fn(n); kids(n).forEach((c) => walk(c, fn)); };
const text = (n) => { let t = ""; walk(n, (x) => { if (typeof x === "string" || typeof x === "number") t += x; }); return t; };
const findAll = (pred) => { const r = []; walk(rt.s.inst.out, (n) => { if (n && n.type && pred(n)) r.push(n); }); return r; };
const iframe = () => findAll((n) => n.type === "iframe")[0];
const saveLink = () => findAll((n) => n.type === "a")[0];
const mainBtn = () => findAll((n) => n.type === "button" && /All departments PDF|Building PDF/.test(text(n)))[0];
const pageText = () => text(rt.s.inst.out);

const ORIGIN = "https://ambria.example";
let listeners;
let anchors;
let created;
let revoked;
let store;

const post = (data, origin = ORIGIN) => rt.act(() => { [...(listeners.message || [])].forEach((l) => l({ data, origin })); });
const advance = (ms) => rt.act(() => vi.advanceTimersByTime(ms));
// a 'file' message is copied (arrayBuffer) before it is saved - a microtask or two, so these tests wait for them
const postA = async (data, origin = ORIGIN) => { post(data, origin); await vi.advanceTimersByTimeAsync(0); };
const start = () => rt.act(() => mainBtn().props.onClick());
const pdfBlob = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });

beforeEach(() => {
  vi.useFakeTimers();
  listeners = {};
  anchors = [];
  created = [];
  revoked = [];
  store = {};
  vi.stubGlobal("window", {
    location: { origin: ORIGIN, pathname: "/ambria-prod/" },
    addEventListener: (t, l) => { (listeners[t] ||= []).push(l); },
    removeEventListener: (t, l) => { listeners[t] = (listeners[t] || []).filter((x) => x !== l); },
  });
  vi.stubGlobal("localStorage", { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } });
  vi.stubGlobal("document", {
    body: { appendChild: (el) => { el.inBody = true; } },
    createElement: (tag) => { const el = { tag, inBody: false, click() { anchors.push({ href: this.href, download: this.download, inBody: this.inBody }); }, remove() { this.inBody = false; } }; return el; },
  });
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { created.push(b); return `blob:${ORIGIN}/id-${++n}`; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => { revoked.push(u); });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  rt.mount(DeptPdfButton, { eventOrderId: "EO-1", clientKey: "C1" });
});
afterEach(() => { try { rt.unmount(); } catch { /* already */ } vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("DeptPdfButton - idle render", () => {
  it("renders nothing without an event order", () => {
    rt.unmount();
    rt.mount(DeptPdfButton, { eventOrderId: null, clientKey: "C9" });
    expect(rt.s.inst.out).toBeNull();
  });
  it("starts on Hindi, remembers the choice, and the frame URL carries pdfEvent + pdfLang", () => {
    expect(pageText()).toContain("All departments PDF · हिं");
    start();
    expect(iframe().props.src).toBe(`${ORIGIN}/ambria-prod/#/ims?pdfEvent=EO-1&pdfLang=hi`);
  });
  it("English when picked (and stored), frame URL says en", () => {
    const en = findAll((n) => n.type === "button" && text(n) === "EN")[0];
    rt.act(() => en.props.onClick());
    expect(store["studio.dealCheck.pdfLang.v2"]).toBe("en");
    start();
    expect(iframe().props.src).toMatch(/pdfLang=en$/);
  });
  it("encodes an event id with odd characters", () => {
    rt.unmount();
    rt.mount(DeptPdfButton, { eventOrderId: "a&b=c d", clientKey: "C2" });
    start();
    expect(iframe().props.src).toContain("pdfEvent=a%26b%3Dc%20d&");
  });
});

describe("DeptPdfButton - message handling while a run is on", () => {
  beforeEach(() => start());

  it("a run shows the hidden frame (opacity 0, off-screen) and a disabled 'Building PDF...' button", () => {
    expect(iframe()).toBeTruthy();
    expect(iframe().props["aria-hidden"]).toBe("true");
    expect(mainBtn().props.disabled).toBe(true);
    expect(text(mainBtn())).toContain("Building PDF");
    expect(listeners.message).toHaveLength(1);
  });

  it("a foreign origin is ignored: no file, no 'PDF ready', run continues", () => {
    post({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob(), name: "x.pdf" }, "https://evil.example");
    post({ type: "ambria-dept-pdf", phase: "done" }, "https://evil.example");
    expect(created).toHaveLength(0);
    expect(anchors).toHaveLength(0);
    expect(pageText()).not.toContain("PDF ready");
    expect(iframe()).toBeTruthy();
  });

  it("a wrong type / empty payload is ignored", () => {
    post({ type: "something-else", phase: "done" });
    post(null);
    post("ambria-dept-pdf");
    expect(pageText()).not.toContain("PDF ready");
    expect(iframe()).toBeTruthy();
  });

  it("silent frame: 90 s with nothing heard -> 'Could not start' and the frame is gone", () => {
    advance(89000);
    expect(iframe()).toBeTruthy();
    advance(1500);
    expect(iframe()).toBeFalsy();
    expect(pageText()).toContain("Could not start");
  });

  it("'alive' restarts the 90 s quiet timer; after a heard frame goes quiet the note says it stopped responding", () => {
    advance(80000);
    post({ type: "ambria-dept-pdf", phase: "alive" });
    advance(80000);
    expect(iframe()).toBeTruthy(); // 160 s in, still running because of the ping at 80 s
    post({ type: "ambria-dept-pdf", phase: "alive" });
    advance(91000);
    expect(iframe()).toBeFalsy();
    expect(pageText()).toContain("stopped responding");
  });

  it("a 10 s heartbeat keeps the run alive right up to the 5 minute cap, which then ends it", () => {
    for (let t = 0; t < 29; t++) { advance(10000); post({ type: "ambria-dept-pdf", phase: "alive" }); }
    expect(iframe()).toBeTruthy(); // 290 s
    advance(11000);
    expect(iframe()).toBeFalsy();
    expect(pageText()).toContain("took too long");
  });

  it("'file' with a Blob: a copy is saved from the page (anchor in the DOM, clicked), the run ends at once with 'PDF ready' and a Save link", async () => {
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob(), name: "All departments - Mehra - 2026-12-01.pdf" });
    expect(created).toHaveLength(1);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ href: "blob:" + ORIGIN + "/id-1", download: "All departments - Mehra - 2026-12-01.pdf", inBody: true });
    expect(revoked).toHaveLength(0); // never revoked in the same tick as the click
    expect(iframe()).toBeFalsy(); // the file is here - nothing left to wait for from the frame
    expect(pageText()).toContain("PDF ready — if it didn't download, tap ⬇ Save PDF");
    expect(saveLink().props).toMatchObject({ href: "blob:" + ORIGIN + "/id-1", download: "All departments - Mehra - 2026-12-01.pdf" });
    expect(text(saveLink())).toContain("Save PDF");
  });

  it("'file' without a name falls back to 'All departments.pdf'", async () => {
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob() });
    expect(anchors[0].download).toBe("All departments.pdf");
  });

  it("a 'done' after the file changes nothing (the run is already over)", async () => {
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob(), name: "B.pdf" });
    await postA({ type: "ambria-dept-pdf", phase: "done", notes: [] });
    expect(pageText()).toContain("PDF ready");
    expect(saveLink().props.download).toBe("B.pdf");
    expect(anchors).toHaveLength(1);
  });

  it("'done' with NO file before it does not claim 'PDF ready': it says the PDF did not arrive, and offers no link", async () => {
    await postA({ type: "ambria-dept-pdf", phase: "done", notes: [] });
    expect(pageText()).not.toContain("PDF ready");
    expect(pageText()).toContain("did not reach this page");
    expect(saveLink()).toBeFalsy();
    expect(anchors).toHaveLength(0);
  });

  it("the note clears itself (12 s), the Save link stays", async () => {
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob(), name: "B.pdf" });
    expect(pageText()).toContain("PDF ready");
    advance(12100);
    expect(pageText()).not.toContain("PDF ready");
    expect(saveLink()).toBeTruthy();
  });

  it("'file' with NO blob is ignored (no download, no link)", async () => {
    await postA({ type: "ambria-dept-pdf", phase: "file", name: "x.pdf" });
    expect(created).toHaveLength(0);
    expect(anchors).toHaveLength(0);
    expect(iframe()).toBeTruthy();
  });

  it("a 'file' that cannot be kept (createObjectURL throws) says so instead of staying on 'Building PDF...'", async () => {
    URL.createObjectURL.mockImplementation(() => { throw new TypeError("not a Blob"); });
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: { not: "a blob" }, name: "x.pdf" });
    expect(anchors).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
    expect(iframe()).toBeFalsy();
    expect(pageText()).toContain("could not be saved");
  });

  it("'error' shows its reason; with no reason, a generic line (+ first note)", () => {
    post({ type: "ambria-dept-pdf", phase: "error", reason: "No department plan on this event yet — sync it from Deal Check first" });
    expect(pageText()).toContain("No department plan on this event yet");
    expect(iframe()).toBeFalsy();
    start();
    post({ type: "ambria-dept-pdf", phase: "error", notes: ["boom"] });
    expect(pageText()).toContain("Could not build the PDF — boom");
  });

  it("HTML fallback: the report (.html) is saved from the page, the note says it is a web page, the link says so too", async () => {
    const html = new Blob(["<html>"], { type: "text/html" });
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: html, name: "All departments (partial — export failed) - X.html", notes: [] });
    await postA({ type: "ambria-dept-pdf", phase: "error", notes: ["The PDF could not be generated"] });
    expect(anchors[0].download).toMatch(/\.html$/);
    expect(saveLink().props.download).toMatch(/\.html$/);
    expect(text(saveLink())).toContain("Save report (.html)");
    expect(pageText()).toContain("web page of the report is ready");
  });
});

describe("DeptPdfButton - the saved file's link lifetime and cleanup", () => {
  const deliver = async (name = "B.pdf") => {
    start();
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob(), name });
  };

  it("the link is still there 60 s after the file", async () => {
    await deliver();
    advance(60000);
    expect(saveLink()).toBeTruthy();
  });

  it("the link goes after 2 minutes and its object URL is revoked (fixed: the timer is its own effect)", async () => {
    await deliver();
    advance(125000);
    expect(saveLink()).toBeFalsy();
    expect(revoked).toContain("blob:" + ORIGIN + "/id-1");
  });

  it("starting another run drops the old link and frees its URL", async () => {
    await deliver();
    start();
    expect(saveLink()).toBeFalsy();
    expect(revoked).toEqual(["blob:" + ORIGIN + "/id-1"]);
  });

  it("unmount removes the listener, stops the quiet / cap timers and frees the file URL", async () => {
    await deliver();
    start();
    expect(listeners.message).toHaveLength(1);
    rt.unmount();
    expect(listeners.message).toHaveLength(0);
    advance(400000);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("unmounting while a file link is showing revokes its URL", async () => {
    await deliver();
    rt.unmount();
    expect(revoked).toContain("blob:" + ORIGIN + "/id-1");
  });

  it("a second run does not hear the first run's listener twice", async () => {
    await deliver();
    start();
    expect(listeners.message).toHaveLength(1);
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob(), name: "B2.pdf" });
    expect(anchors.filter((a) => a.download === "B2.pdf")).toHaveLength(1);
  });

  it("a frame that sends the file and then dies no longer shows 'stopped responding' - the page already says ready", async () => {
    start();
    await postA({ type: "ambria-dept-pdf", phase: "file", blob: pdfBlob(), name: "B.pdf" });
    advance(91000);
    expect(pageText()).not.toContain("stopped responding");
    expect(saveLink()).toBeTruthy();
  });
});
