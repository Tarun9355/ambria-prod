import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DraftInput (src/components/ui/index.jsx) run for real on a tiny fake hook runtime (no jsdom / testing-library in this repo).
// "react" is replaced by useState / useRef / useEffect that keep their state between renders, run effects after each render and
// cleanups before re-running them / on unmount, and can replay React StrictMode's mount -> unmount -> mount cycle.
const rt = vi.hoisted(() => ({ hooks: [], idx: 0, dirty: false, pending: [], unmounted: false, el: null, props: null }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  const useState = (init) => {
    const i = rt.idx++;
    if (rt.hooks[i] === undefined) rt.hooks[i] = { v: typeof init === "function" ? init() : init };
    const h = rt.hooks[i];
    if (!h.set) {
      h.set = (nv) => {
        if (rt.unmounted) return; // React ignores a state change of an unmounted component
        const val = typeof nv === "function" ? nv(h.v) : nv;
        if (!Object.is(val, h.v)) { h.v = val; rt.dirty = true; }
      };
    }
    return [h.v, h.set];
  };
  const useRef = (init) => {
    const i = rt.idx++;
    if (rt.hooks[i] === undefined) rt.hooks[i] = { v: { current: init } };
    return rt.hooks[i].v;
  };
  const useEffect = (fn, deps) => {
    const i = rt.idx++;
    if (rt.hooks[i] === undefined) rt.hooks[i] = { effect: true, deps: undefined, cleanup: undefined, ran: false };
    const h = rt.hooks[i];
    const changed = !h.ran || !deps || !h.deps || deps.some((d, k) => !Object.is(d, h.deps[k]));
    if (changed) rt.pending.push({ h, fn, deps });
  };
  return { ...actual, useState, useRef, useEffect, default: { ...actual, useState, useRef, useEffect } };
});

import { DraftInput } from "./index.jsx";

const commitEffects = () => {
  const run = rt.pending; rt.pending = [];
  run.forEach(({ h }) => { if (h.cleanup) { const c = h.cleanup; h.cleanup = undefined; c(); } });
  run.forEach((e) => { e.h.deps = e.deps; e.h.ran = true; const c = e.fn(); if (typeof c === "function") e.h.cleanup = c; });
};
const settle = () => {
  let n = 0;
  do {
    rt.dirty = false; rt.idx = 0;
    rt.el = DraftInput(rt.props);
    commitEffects();
    if (++n > 50) throw new Error("render loop");
  } while (rt.dirty);
};

function mount(props, { strict = false } = {}) {
  rt.hooks = []; rt.idx = 0; rt.dirty = false; rt.pending = []; rt.unmounted = false; rt.el = null;
  const commits = [];
  rt.props = { onCommit: (raw) => { commits.push(raw); props.onCommitExtra?.(raw); }, ...props };
  delete rt.props.onCommitExtra;
  settle();
  if (strict) {
    // React StrictMode (dev): after the first mount every effect is cleaned up and run again, with state and refs kept
    rt.hooks.forEach((h) => { if (h && h.effect && h.cleanup) { const c = h.cleanup; h.cleanup = undefined; c(); } });
    // re-run: the simplest faithful way is to make every effect look "never ran" and render once more (state and refs are kept)
    rt.hooks.forEach((h) => { if (h && h.effect) h.ran = false; });
    settle();
  }
  return {
    commits,
    get input() { return rt.el.props; },
    get shown() { return rt.el.props.value; },
    type(raw) { rt.el.props.onChange({ target: { value: raw } }); settle(); },
    blur() { rt.el.props.onBlur({}); settle(); },
    advance(ms) { vi.advanceTimersByTime(ms); settle(); },
    setProps(p) { rt.props = { ...rt.props, ...p }; settle(); },
    unmount() { rt.hooks.forEach((h) => { if (h && h.effect && h.cleanup) { const c = h.cleanup; h.cleanup = undefined; c(); } }); rt.unmounted = true; },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("DraftInput commit path (real component, fake hooks)", () => {
  it("shows the prop when nothing is being typed; null / undefined prop shows an empty box", () => {
    expect(mount({ value: 40 }).shown).toBe(40);
    expect(mount({ value: undefined }).shown).toBe("");
    expect(mount({ value: null }).shown).toBe("");
  });

  it("typing: the draft is shown at once; one commit 250 ms after typing pauses, keystrokes inside the window collapse to one", () => {
    const m = mount({ value: "" });
    m.type("1"); m.advance(100); m.type("12"); m.advance(100); m.type("123");
    expect(m.shown).toBe("123");
    expect(m.commits).toEqual([]);
    m.advance(249);
    expect(m.commits).toEqual([]);
    m.advance(1);
    expect(m.commits).toEqual(["123"]);
    m.advance(10000);
    expect(m.commits).toEqual(["123"]); // never committed twice
  });

  it("blur commits immediately and exactly once (the pending debounce timer does not fire a second commit)", () => {
    const m = mount({ value: "" });
    m.type("55");
    m.blur();
    expect(m.commits).toEqual(["55"]);
    m.advance(1000);
    expect(m.commits).toEqual(["55"]);
  });

  it("blur with nothing typed commits nothing and shows the prop", () => {
    const m = mount({ value: 7 });
    m.blur();
    expect(m.commits).toEqual([]);
    expect(m.shown).toBe(7);
  });

  it("debounced commit while still focused, then blur: still exactly one commit (nothing pending at blur)", () => {
    const m = mount({ value: "" });
    m.type("9"); m.advance(250);
    expect(m.commits).toEqual(["9"]);
    m.blur();
    expect(m.commits).toEqual(["9"]);
  });

  it("unmount with a pending change commits it once, and leaves no timer behind (hold timer from the unmount flush is cleared)", () => {
    const m = mount({ value: "" });
    m.type("77");
    m.unmount();
    expect(m.commits).toEqual(["77"]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20000);
    expect(m.commits).toEqual(["77"]);
  });

  it("unmount with nothing pending commits nothing", () => {
    const m = mount({ value: 3 });
    m.unmount();
    expect(m.commits).toEqual([]);
  });

  it("unmount after a committed + held change clears the 8 s hold timer", () => {
    const m = mount({ value: "" });
    m.type("4"); m.blur();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the LATEST onCommit (a re-render with a new closure is what a late debounce commit calls)", () => {
    const first = vi.fn(), second = vi.fn();
    const m = mount({ value: "", onCommit: first });
    m.type("1");
    m.setProps({ onCommit: second });
    m.advance(250);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("1");
  });

  it("passes readOnly / disabled / type / className / title and a caller onBlur through; `delay` and `onCommit` never reach the DOM", () => {
    const onBlur = vi.fn();
    const m = mount({ value: 5, type: "number", readOnly: true, disabled: true, className: "x", title: "t", onBlur, delay: 10 });
    expect(m.input).toMatchObject({ type: "number", readOnly: true, disabled: true, className: "x", title: "t" });
    expect(m.input.onCommit).toBeUndefined();
    expect(m.input.delay).toBeUndefined();
    m.blur();
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(m.commits).toEqual([]);
  });

  it("a custom delay is honoured", () => {
    const m = mount({ value: "", delay: 1000 });
    m.type("x"); m.advance(999);
    expect(m.commits).toEqual([]);
    m.advance(1);
    expect(m.commits).toEqual(["x"]);
  });
});

describe("DraftInput held text (what the box shows between the commit and the saved value arriving)", () => {
  it("after blur the committed text stays on screen while the prop is still the old value (no flash of the old value)", () => {
    const m = mount({ value: 40 });
    m.type("50"); m.blur();
    expect(m.shown).toBe("50");
    m.advance(2000);
    expect(m.shown).toBe("50");
  });

  it("when the saved value arrives the prop is shown again (normalised or not)", () => {
    const m = mount({ value: 40 });
    m.type("50.0"); m.blur();
    m.setProps({ value: 50 });
    expect(m.shown).toBe(50);
    // and after that a re-render with the same value keeps showing the prop, not a stale held copy
    m.setProps({ value: 50 });
    expect(m.shown).toBe(50);
  });

  it("8 s fallback: a save that never lands puts the real value back after 8 s, not before", () => {
    const m = mount({ value: 40 });
    m.type("50"); m.blur();
    m.advance(7999);
    expect(m.shown).toBe("50");
    m.advance(1);
    expect(m.shown).toBe(40);
  });

  it("a second commit restarts the 8 s window", () => {
    const m = mount({ value: 40 });
    m.type("50"); m.blur(); m.advance(5000);
    m.type("60"); m.blur(); m.advance(5000);
    expect(m.shown).toBe("60"); // 10 s after the first commit but 5 s after the second
    m.advance(3000);
    expect(m.shown).toBe(40);
  });

  it("number prop vs string held.base compare by text: 5 and '5' count as unchanged", () => {
    const m = mount({ value: 5 });
    m.type("7"); m.blur();
    m.setProps({ value: "5" }); // same text, different type: not an arrival
    expect(m.shown).toBe("7");
    m.setProps({ value: 7 });
    expect(m.shown).toBe(7);
  });

  it("clearing the box (raw '') commits '' once and shows an empty box, not the old value", () => {
    const m = mount({ value: 12 });
    m.type(""); m.blur();
    expect(m.commits).toEqual([""]);
    expect(m.shown).toBe("");
    m.setProps({ value: "" });
    expect(m.shown).toBe("");
  });

  it("the prop arriving as exactly the typed text clears the hold and shows the prop", () => {
    const m = mount({ value: "a" });
    m.type("b"); m.blur();
    m.setProps({ value: "b" });
    expect(m.shown).toBe("b");
    m.setProps({ value: "c" }); // a later remote change must show through, not be blocked by an old hold
    expect(m.shown).toBe("c");
  });

  it("a remote change while the person is typing never overwrites the draft; after the blur their text is what is committed and shown", () => {
    const m = mount({ value: 40 });
    m.type("5");
    m.setProps({ value: 45 });
    expect(m.shown).toBe("5");
    m.type("50"); m.blur();
    expect(m.commits).toEqual(["50"]);
    expect(m.shown).toBe("50");
    m.setProps({ value: 50 });
    expect(m.shown).toBe(50);
  });

  it("echo of a debounced commit arrives while still focused: draft keeps showing, blur then shows the prop", () => {
    const m = mount({ value: 1 });
    m.type("1.50"); m.advance(250);
    m.setProps({ value: 1.5 });
    expect(m.shown).toBe("1.50");
    m.blur();
    expect(m.shown).toBe(1.5);
    expect(m.commits).toEqual(["1.50"]);
  });

  // trade-off of the overlap fix: the hold now ends only when the prop reaches the committed text, so a DIFFERENT value saved by
  // someone else in those seconds shows once the 8 s fallback releases the hold (a save of the same box by two people at once)
  it("a remote change to a held field (someone else saved a different value) shows when the 8 s hold ends", () => {
    const m = mount({ value: 40 });
    m.type("50"); m.blur();
    m.setProps({ value: 60 });
    expect(m.shown).toBe("50");
    m.advance(8000);
    expect(m.shown).toBe(60);
  });
});

describe("DraftInput under React StrictMode (mount, unmount, mount)", () => {
  it("does not commit on mount, and `mounted` ends true so a later commit still holds its text", () => {
    const m = mount({ value: 40 }, { strict: true });
    expect(m.commits).toEqual([]);
    m.type("50"); m.blur();
    expect(m.commits).toEqual(["50"]);
    expect(m.shown).toBe("50"); // would be 40 if mounted.current had stayed false
    m.advance(8000);
    expect(m.shown).toBe(40); // the 8 s timer also still works
  });

  it("the simulated unmount's flush finds nothing pending, so no spurious commit", () => {
    const m = mount({ value: "" }, { strict: true });
    expect(m.commits).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("typing + debounce commit in StrictMode commits once", () => {
    const m = mount({ value: "" }, { strict: true });
    m.type("8"); m.advance(250); m.blur(); m.advance(500);
    expect(m.commits).toEqual(["8"]);
  });
});

describe("DraftInput - limitations / bugs found", () => {
  // BUG (flash of the old value, the thing the hold was written to prevent, comes back when two edits of the SAME box overlap):
  // the [value] effect clears `held` as soon as `value` differs from held.base - but the first save's echo makes `value` differ while
  // the SECOND commit is still in flight. The hold of the second commit is dropped, and after blur the box shows the first echo.
  it("fixed: two quick edits A then B before the prop echoes - after A's echo arrives the box must keep showing B (it shows A until B lands)", () => {
    const m = mount({ value: 40 });
    m.type("5"); m.blur();                // A committed, held {5, base 40}
    m.type("55"); m.advance(250);         // B committed by the debounce while A is still in flight, held {55, base 40}
    m.setProps({ value: 5 });             // A's save echoes back (B's has not yet)
    m.blur();                             // focus leaves: draft dropped
    expect(m.commits).toEqual(["5", "55"]);
    expect(m.shown).toBe("55");           // currently 5 (A's stale echo) until B's echo arrives
    m.setProps({ value: 55 });
    expect(m.shown).toBe(55);
  });

  it("same overlap, but blurring in between (A blur, B blur, then A's echo): the box keeps showing B until B's echo arrives", () => {
    const m = mount({ value: 40 });
    m.type("5"); m.blur();
    m.type("55"); m.blur();
    m.setProps({ value: 5 });
    expect(m.shown).toBe("55");
    m.setProps({ value: 55 });
    expect(m.shown).toBe(55);
  });

  it("LIMITATION: a commit the owner's onCommit normalises to the value the prop already has (typed '0' on an empty qty box, '40.0' on 40) keeps the raw text for 8 s, then snaps to the prop", () => {
    const m = mount({ value: "" });
    m.type("0"); m.blur();               // qty box: parseFloat("0") || 0 -> 0 -> value stays "" (fl.qty || "")
    expect(m.shown).toBe("0");
    m.advance(8000);
    expect(m.shown).toBe("");            // the typed 0 disappears after 8 s
    const n = mount({ value: 40 });
    n.type("40.0"); n.blur();
    expect(n.shown).toBe("40.0");
    n.advance(8000);
    expect(n.shown).toBe(40);
  });

  it("LIMITATION: a failed save leaves the typed text on screen for 8 s (by design) and then reverts silently", () => {
    const m = mount({ value: 40 });
    m.type("99"); m.blur();
    m.advance(7999);
    expect(m.shown).toBe("99");
    m.advance(1);
    expect(m.shown).toBe(40);
  });

  it("an onCommit that throws on blur leaves the draft showing (blur's setDraft(null) never runs) - pre-existing shape, recorded", () => {
    const m = mount({ value: 1, onCommitExtra: () => { throw new Error("boom"); } });
    m.type("2");
    expect(() => m.blur()).toThrow("boom");
    expect(m.shown).toBe("2");
  });
});
