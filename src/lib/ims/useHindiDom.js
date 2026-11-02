import { useLayoutEffect } from "react";
import { uiHindi } from "./uiHindi";

// While `on`, every piece of text inside an element marked data-hi-scope (Dept Ops' root and its popups, which are portals) is shown
// in Hindi (lib/ims/uiHindi), and kept so as React re-renders: a text React changes back to English is turned again. Switching off
// puts each text back to the English it replaced. Only shown text and placeholder / title are touched - never an input's value -
// and anything inside data-no-hi (the EN | हिं toggle itself) is left alone. React only writes a text node when its own value
// changes, so a node shown in Hindi is not fought over.
const SCOPE = "[data-hi-scope]";
const SKIP = "[data-no-hi],script,style,textarea,code,[contenteditable='true']";
const ATTRS = ["placeholder", "title"];
const SHOW_TEXT_AND_ELEMENTS = 0x4 | 0x1; // NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT

export default function useHindiDom(on) {
  useLayoutEffect(() => {
    if (!on || typeof document === "undefined") return undefined;
    const shownText = new WeakMap(); // text node → { en, hi }
    const shownAttr = new WeakMap(); // element → { [attr]: { en, hi } }

    const doText = (node) => {
      const v = node.nodeValue;
      const rec = shownText.get(node);
      if (rec && v === rec.hi) return;
      const el = node.parentElement;
      if (!el || !el.closest(SCOPE) || el.closest(SKIP)) return;
      const hi = uiHindi(v);
      shownText.set(node, { en: v, hi });
      if (hi !== v) node.nodeValue = hi;
    };
    const doAttr = (el, a) => {
      const v = el.getAttribute(a);
      if (v == null) return;
      const recs = shownAttr.get(el) || {};
      if (recs[a] && recs[a].hi === v) return;
      if (!el.closest(SCOPE) || el.closest(SKIP)) return;
      const hi = uiHindi(v);
      shownAttr.set(el, { ...recs, [a]: { en: v, hi } });
      if (hi !== v) el.setAttribute(a, hi);
    };
    const walk = (root) => {
      if (root.nodeType === 3) { doText(root); return; }
      if (root.nodeType !== 1) return;
      ATTRS.forEach(a => root.hasAttribute(a) && doAttr(root, a));
      const tw = document.createTreeWalker(root, SHOW_TEXT_AND_ELEMENTS);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (n.nodeType === 3) doText(n);
        else ATTRS.forEach(a => n.hasAttribute(a) && doAttr(n, a));
      }
    };

    document.querySelectorAll(SCOPE).forEach(walk);
    const mo = new MutationObserver((muts) => {
      muts.forEach(m => {
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") doAttr(m.target, m.attributeName);
        else m.addedNodes.forEach(walk);
      });
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

    return () => {
      mo.disconnect();
      // Back to English: every text / attribute still showing the Hindi put there goes back to its English.
      document.querySelectorAll(SCOPE).forEach(root => {
        const tw = document.createTreeWalker(root, SHOW_TEXT_AND_ELEMENTS);
        const restoreEl = (el) => { const recs = shownAttr.get(el); if (recs) Object.entries(recs).forEach(([a, r]) => { if (el.getAttribute(a) === r.hi) el.setAttribute(a, r.en); }); };
        restoreEl(root);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (n.nodeType === 3) { const r = shownText.get(n); if (r && n.nodeValue === r.hi) n.nodeValue = r.en; }
          else restoreEl(n);
        }
      });
    };
  }, [on]);
}
