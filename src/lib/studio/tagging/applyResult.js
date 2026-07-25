// Apply an aiTagImage() result onto a library photo — the ONE place that merges Claude's tagging
// output into a stored photo (spec §9-B / §12.2).
//
// This logic used to be copy-pasted in three spots that had subtly drifted:
//   - runBulkTag         (StudioApp.jsx)  — "Tag all untagged"
//   - runTagSelected     (StudioApp.jsx)  — "Tag selected"
//   - the single-photo 🤖 AI Tag button   (ManageLibrary.jsx) — which forgot to stamp tag_source,
//                                           so photos re-tagged there silently missed the
//                                           "Manual Tagged" chip. Centralizing fixes that bug.
//
// Pure/dependency-free so it can be unit-tested. Returns a PATCH (only the changed fields) plus a
// gotTags flag; the caller decides how to persist it (into a bulk patch map, or onto an edit draft)
// and how to handle the failure case (bulk paths stamp _aiFailed; the edit modal no-ops).

/**
 * @param {object|null} existing  the photo being tagged (for tags/name/dims fallbacks); may be null
 * @param {object|null} result    what aiTagImage() returned (null/empty on failure)
 * @param {object}      opts
 * @param {object}      opts.taxonomy   the live taxonomy object (its keys are the tag fields to copy)
 * @param {string}     [opts.tagSource] attribution to stamp when tags land ("manual" | "build" | ...)
 * @returns {{ patch: object, gotTags: boolean }}
 *   patch — changed fields only. When gotTags, it also carries _aiTagged/_aiTaggedAt (+ tagSource).
 *   gotTags — did the AI actually return usable tags or elements? (false on null/empty result)
 */
export function applyAiTagResult(existing, result, { taxonomy, tagSource } = {}) {
  const patch = {};
  let gotTags = false;

  if (result) {
    // Taxonomy tags — copy only the non-empty arrays for known fields onto the existing tags.
    const tagSrc = result.tags || result;
    if (tagSrc) {
      const t = { ...(existing?.tags || {}) };
      let any = false;
      Object.keys(taxonomy || {}).forEach((k) => {
        if (Array.isArray(tagSrc[k]) && tagSrc[k].length) { t[k] = tagSrc[k]; any = true; }
      });
      if (any) { patch.tags = t; gotTags = true; }
    }

    // Name — only replace a missing/placeholder name, never a human-chosen one.
    const nm = existing?.name;
    if (result.name && (!nm || nm.startsWith("img ") || nm === "Untitled")) patch.name = result.name;

    if (Array.isArray(result.elements) && result.elements.length > 0) { patch.elements = result.elements; gotTags = true; }
    if (typeof result.lightCount === "number") patch.lightCount = result.lightCount;
    if (Array.isArray(result.unrecognized)) patch.unrecognized = result.unrecognized;
    if (result.tags && typeof result.tags === "object") patch._aiTags = result.tags; // snapshot for the corrections diff at review time
    if (result._aiThinking) patch._aiThinking = result._aiThinking;
    if (result._aiRawResponse) patch._aiRawResponse = result._aiRawResponse;
    if (typeof result._aiConfidence === "number") patch._aiConfidence = result._aiConfidence; // tag-time confidence estimate (shown as a per-photo badge)

    const d = result.dims || {};
    if (d.trussL || d.trussW || d.trussH || d.floorL || d.floorW) {
      patch.dims = {
        ...(existing?.dims || {}),
        trussL: d.trussL || 0, trussW: d.trussW || 0, trussH: d.trussH || 0,
        floorL: d.floorL || 0, floorW: d.floorW || 0,
        plH: d.plH || existing?.dims?.plH || "",
        mkT: d.mkT || existing?.dims?.mkT || "",
        mkWalls: d.mkWalls || existing?.dims?.mkWalls || {},
      };
    }
  }

  // Only mark "AI-tagged" when we actually got tags — a failed/empty pass (e.g. credits out) stays
  // untagged so it's retried next run instead of looking done-but-blank.
  if (gotTags) {
    patch._aiTagged = true;
    patch._aiTaggedAt = Date.now();
    if (tagSource) patch.tagSource = tagSource;
  }

  return { patch, gotTags };
}
