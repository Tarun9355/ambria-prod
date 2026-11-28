import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Tabs, useConfirm } from "../../components/ui";
import { ATTENDANCE_QUIZ_DEPTS, ATTENDANCE_QUIZ_DEPT_ICON } from "../../lib/ims/attendance";
import { userDepartments } from "../../lib/ims/deptClassify";
import { supabase } from "../../lib/supabase";
import { translateToHindi } from "../../lib/ims/translateHindi";
import {
  IconYoutubeMark, IconLink, IconTrash, IconInfo, IconPlusCircle, IconSave, IconX, IconPlay,
  IconCheck, IconAlert, IconClipboardCheck,
} from "../../components/icons.jsx";
import { extractYouTubeId } from "./AttendanceVideoPlayer.jsx";

// ═══════════════════════════════════════════════════════════════════════════
// QUIZ SETUP — one punch-in briefing (video + questions) per BUILD DEPARTMENT, not one shared
// across everyone. A Floral labourer and a Lighting electrician don't need the same safety
// briefing, so this is six independent configs rather than the single one Attendance briefly had.
//
// Which department a staff member sees is decided at punch-in time by their own department
// (attendanceQuizDept in lib/ims/attendance.js) — this panel only edits the six configs, it
// doesn't assign anyone to a department (that's Admin → Users, same as it already was for every
// other department-scoped screen in IMS).
//
// Lives INSIDE the Attendance tab (an admin-only toggle, same as "View all staff attendance"),
// not a top-level nav tab of its own — it's config for a feature Attendance already owns.
//
// Stored under settings.attendanceTrainingByDept[dept] — a JSON object per department, not a CRUD
// table, so each department's panel edits a local draft and writes it back in one go.
//
// ── BILINGUAL AUTHORING ──
// Every question, option, and accepted answer carries an English/Hinglish source (what the admin
// types) alongside a Hindi translation (textHi/optionsHi/acceptedAnswersHi) that auto-fills via
// Claude (lib/ims/translateHindi.js) a moment after typing stops — crew reading the punch-in quiz
// may be far more comfortable in Hindi than English. The Hindi field stays a plain editable input,
// not read-only: auto-fill is a starting point, not the only way it can be set.
// ═══════════════════════════════════════════════════════════════════════════

const letterFor = (i) => String.fromCharCode(65 + i);

// Shared control looks — literal strings so Tailwind sees every class. Tap targets are 40px on
// phones; the small icon buttons tighten to 32px from sm: up, where a pointer is precise.
const btnPrimary = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";
const btnGhost = "inline-flex items-center gap-1.5 h-10 sm:h-9 px-3 -ml-3 rounded-xl text-sm font-semibold text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const iconBtnDanger = "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500";
const iconBtnSmall = "shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500";
// text-base (16px) on phone, text-sm from sm: up — under 16px, iOS Safari zooms the page on focus.
const selectCls = "h-10 rounded-xl border border-gray-200 bg-white pl-3 pr-8 text-base sm:text-sm text-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";
const inputCls = "w-full h-10 rounded-xl border border-gray-200 pl-11 pr-3 text-base sm:text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";

export default function QuizSetupPanel({ settings, authUser }) {
  // Dept Heads / Site Supervisors see only their own department tab(s); Admin keeps all.
  // userDepartments returns null for unrestricted (Admin) — hand the full catalogue back then.
  const visibleDepts = useMemo(() => {
    const mine = userDepartments(authUser);
    if (!mine) return ATTENDANCE_QUIZ_DEPTS;
    const allowed = ATTENDANCE_QUIZ_DEPTS.filter((d) => mine.includes(d));
    // A dept head whose role names a dept outside the 8 quiz depts (e.g. "Dept Head - Painter")
    // falls through to zero — they'd see an empty panel, which is honest about them having no
    // briefing to edit; the panel below renders a soft empty state instead of a broken tab strip.
    return allowed;
  }, [authUser]);

  const [dept, setDept] = useState(visibleDepts[0] || ATTENDANCE_QUIZ_DEPTS[0]);
  useEffect(() => { if (visibleDepts.length && !visibleDepts.includes(dept)) setDept(visibleDepts[0]); }, [visibleDepts, dept]);

  if (!visibleDepts.length) {
    return (
      <div className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm px-6 py-10 text-center">
        <p className="text-sm font-medium text-gray-700">No quiz department assigned to your role.</p>
        <p className="mt-1 text-xs text-gray-500">Ask Admin to grant your dept in Users &amp; Roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs
        tabs={visibleDepts.map((d) => ({ id: d, label: `${ATTENDANCE_QUIZ_DEPT_ICON[d]} ${d}` }))}
        active={dept}
        onChange={setDept}
      />
      {/* Keyed on dept so each department gets a fresh draft/save-status state instead of one editor
          instance quietly carrying stale local state across a department switch. */}
      <DeptQuizEditor key={dept} dept={dept} settings={settings} />
    </div>
  );
}

function DeptQuizEditor({ dept, settings }) {
  const saved = settings?.attendanceTrainingByDept?.[dept] || { videoUrl: "", questions: [] };
  const [draft, setDraft] = useState(saved);
  const [confirm, confirmDialog] = useConfirm();
  // null | "saving" | "saved" | "error" — shown beside the Save button.
  const [saveState, setSaveState] = useState(null);
  const uid = useId();
  // A pasted link is just text until it resolves to a real video — the thumbnail below the input
  // is what actually confirms which video got added (title, thumbnail), not the raw URL string.
  const videoId = extractYouTubeId(draft.videoUrl);

  // Another admin (or another tab) can change this while the panel is open — settings arrives
  // live via realtime, so pick up their edit rather than silently overwriting it on next Save.
  useEffect(() => {
    setDraft(settings?.attendanceTrainingByDept?.[dept] || { videoUrl: "", questions: [] });
    // eslint-disable-next-line -- react-hooks/exhaustive-deps is stubbed repo-wide (see CLAUDE.md); dept is a prop, not state, so it can't itself go stale here
  }, [settings?.attendanceTrainingByDept?.[dept]]);

  // One shared debounce map for every bilingual field on the page (question text, each option,
  // each accepted answer) keyed by a field id, rather than a separate timer/effect per field —
  // there can be a dozen+ of these on one department's page.
  const timersRef = useRef({});
  useEffect(() => () => Object.values(timersRef.current).forEach(clearTimeout), []);
  function scheduleTranslate(key, text, apply) {
    clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(async () => {
      const hi = await translateToHindi(text, "hinglish");
      if (hi != null) apply(hi);
    }, 700);
  }

  // null = modal closed · id of a question currently being edited in the focused modal
  const [editingQid, setEditingQid] = useState(null);
  function addQuestion() {
    const id = "q" + Date.now();
    setDraft((d) => ({ ...d, questions: [...d.questions, { id, type: "single", text: "", textHi: "", options: ["", ""], optionsHi: ["", ""], correctIndex: 0 }] }));
    setEditingQid(id);
  }
  // Closing a fully-blank question (e.g. admin clicked Add then Cancel) drops it from the draft so
  // the list doesn't fill up with scratch rows. A touched-but-partial question stays — the admin
  // can come back to finish it later.
  function closeEditor() {
    setDraft((d) => {
      const q = d.questions.find((x) => x.id === editingQid);
      const blank = q && !q.text.trim() && !(q.options || []).some((o) => o.trim()) && !(q.acceptedAnswers || []).some((a) => a.trim());
      return blank ? { ...d, questions: d.questions.filter((x) => x.id !== editingQid) } : d;
    });
    setEditingQid(null);
  }
  function updateQuestion(id, patch) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  }
  async function removeQuestion(id) {
    if (!(await confirm({ title: "Delete this question?", body: "It, its options and answers are removed from the quiz (until you leave without saving)." }))) return;
    setDraft((d) => ({ ...d, questions: d.questions.filter((q) => q.id !== id) }));
  }
  // Switching type reshapes the question to that type's own fields — `text`/`textHi` carry over
  // (type-agnostic), everything else resets to a sensible blank rather than leaving, say, a
  // `correctIndex` sitting unused on a fill-in-the-blank question.
  function setQuestionType(id, type) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) => {
        if (q.id !== id) return q;
        const base = { id: q.id, type, text: q.text, textHi: q.textHi || "" };
        if (type === "single") return { ...base, options: ["", ""], optionsHi: ["", ""], correctIndex: 0 };
        if (type === "multi") return { ...base, options: ["", ""], optionsHi: ["", ""], correctIndexes: [] };
        if (type === "fill_blank") return { ...base, acceptedAnswers: [""], acceptedAnswersHi: [""] };
        return base; // short_answer has no correct-answer fields at all
      }),
    }));
  }
  function updateOption(qid, oi, text) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, options: q.options.map((o, i) => (i === oi ? text : o)) } : q)) }));
  }
  function updateOptionHi(qid, oi, text) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, optionsHi: (q.optionsHi || []).map((o, i) => (i === oi ? text : o)) } : q)) }));
  }
  function addOption(qid) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, options: [...q.options, ""], optionsHi: [...(q.optionsHi || []), ""] } : q)) }));
  }
  // Shared by single and multi choice — which correct-answer field to shift depends on the
  // question's own type.
  function removeOption(qid, oi) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) => {
        if (q.id !== qid) return q;
        const options = q.options.filter((_, i) => i !== oi);
        const optionsHi = (q.optionsHi || []).filter((_, i) => i !== oi);
        if (q.type === "multi") {
          const correctIndexes = (q.correctIndexes || []).filter((i) => i !== oi).map((i) => (i > oi ? i - 1 : i));
          return { ...q, options, optionsHi, correctIndexes };
        }
        const correctIndex = q.correctIndex === oi ? 0 : q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex;
        return { ...q, options, optionsHi, correctIndex };
      }),
    }));
  }
  function toggleMultiCorrect(qid, oi) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) => {
        if (q.id !== qid) return q;
        const has = (q.correctIndexes || []).includes(oi);
        const correctIndexes = has ? q.correctIndexes.filter((i) => i !== oi) : [...(q.correctIndexes || []), oi];
        return { ...q, correctIndexes };
      }),
    }));
  }
  function updateAcceptedAnswer(qid, ai, text) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, acceptedAnswers: q.acceptedAnswers.map((a, i) => (i === ai ? text : a)) } : q)) }));
  }
  function updateAcceptedAnswerHi(qid, ai, text) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, acceptedAnswersHi: (q.acceptedAnswersHi || []).map((a, i) => (i === ai ? text : a)) } : q)) }));
  }
  function addAcceptedAnswer(qid) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, acceptedAnswers: [...q.acceptedAnswers, ""], acceptedAnswersHi: [...(q.acceptedAnswersHi || []), ""] } : q)) }));
  }
  function removeAcceptedAnswer(qid, ai) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, acceptedAnswers: q.acceptedAnswers.filter((_, i) => i !== ai), acceptedAnswersHi: (q.acceptedAnswersHi || []).filter((_, i) => i !== ai) } : q)) }));
  }
  function save() {
    // Drop fully-blank questions rather than persisting scratch rows an admin started and abandoned.
    const hasContent = (q) => q.text.trim() || q.options?.some((o) => o.trim()) || q.acceptedAnswers?.some((a) => a.trim());
    const cleaned = { ...draft, questions: draft.questions.filter(hasContent) };
    // Feedback follows the write's own result — "Saved" once it lands, a retry hint if it didn't —
    // rather than flashing "Saved" the instant the button is pressed whatever happens next.
    clearTimeout(timersRef.current.__saved);
    setSaveState("saving");
    supabase.from("attendance_training").upsert({ dept, video_url: cleaned.videoUrl, questions: cleaned.questions }, { onConflict: "dept" }).then(
      ({ error }) => {
        setSaveState(error ? "error" : "saved");
        if (!error) timersRef.current.__saved = setTimeout(() => setSaveState(null), 2000);
      },
      () => setSaveState("error"),
    );
  }

  const urlTyped = draft.videoUrl.trim() !== "";

  return (
    <div className="space-y-4 text-left">
      {confirmDialog}

      {/* ── BRIEFING VIDEO ── */}
      <section aria-label="Briefing video" className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
        <div className="px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><IconYoutubeMark size={15} /> Briefing video</h3>
          <p className="mt-0.5 text-xs text-gray-500">Shown before every {dept.toLowerCase()} punch-in.</p>
        </div>
        <div className="border-t border-gray-100 px-5 py-4">
          <label htmlFor={`${uid}-video`} className="block text-xs font-medium text-gray-700 mb-1.5">YouTube link</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"><IconLink size={16} /></span>
            <input id={`${uid}-video`} type="url" inputMode="url" value={draft.videoUrl} onChange={(e) => setDraft((d) => ({ ...d, videoUrl: e.target.value }))}
              placeholder="Paste any YouTube link"
              className="w-full h-10 rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-base sm:text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500" />
          </div>
          {/* A pasted link is just text until it resolves to a real video — the thumbnail is what
              confirms which video got added; a link that doesn't resolve says so instead. */}
          {videoId ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-gray-50 ring-1 ring-gray-100 p-2.5">
              <div className="relative w-24 sm:w-28 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
                <img src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-red-600 pl-0.5"><IconPlay size={13} /></div>
                </div>
              </div>
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 ring-1 ring-green-200 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <IconCheck size={12} /> Video added
                </span>
                <p className="mt-1 text-xs text-gray-500 truncate">{draft.videoUrl}</p>
              </div>
            </div>
          ) : urlTyped ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700"><IconAlert size={13} /> Not a YouTube video link yet — check it's the full link.</p>
          ) : null}
        </div>
      </section>

      {/* ── QUIZ QUESTIONS ── */}
      <section aria-label="Quiz questions" className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
        <div className="px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <IconClipboardCheck size={15} /> Questions after the video
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">{draft.questions.length}</span>
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">Type in English or Hinglish — the Hindi version (हिं) fills in by itself a moment after you stop typing.</p>
        </div>

        <div className="border-t border-gray-100 p-4 sm:p-5">
          {draft.questions.length === 0 ? (
            <div className="py-8 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><IconClipboardCheck size={18} /></div>
              <p className="mt-3 text-sm font-medium text-gray-700">No questions yet</p>
              <p className="mt-1 text-xs text-gray-500">Staff go straight from the video to the selfie. Add a question to check they watched it.</p>
              <button onClick={addQuestion} className={btnSecondary + " mt-4"}>
                <IconPlusCircle size={16} /> Add a question
              </button>
            </div>
          ) : (
          <ol className="space-y-2">
            {draft.questions.map((q, qi) => (
              <QuestionSummaryRow key={q.id} q={q} qi={qi}
                onEdit={() => setEditingQid(q.id)}
                onDelete={() => removeQuestion(q.id)}
              />
            ))}
          </ol>
          )}
        </div>
      </section>

      {editingQid && (() => {
        const q = draft.questions.find((x) => x.id === editingQid);
        if (!q) return null;
        const qi = draft.questions.findIndex((x) => x.id === editingQid);
        const type = q.type || "single";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-label={`Edit question ${qi + 1}`}
            onClick={(e) => { if (e.target === e.currentTarget) closeEditor(); }}>
            <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white shadow-xl ring-1 ring-gray-200/70">
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0 w-8 h-8 rounded-xl bg-blue-100 text-blue-600 text-sm font-bold flex items-center justify-center" aria-hidden="true">{qi + 1}</span>
                  <h3 className="text-sm font-semibold text-gray-900 truncate">Question {qi + 1}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <select value={type} onChange={(e) => setQuestionType(q.id, e.target.value)} aria-label="Question type"
                    className={selectCls + " font-medium min-w-0"}>
                    <option value="single">Single choice</option>
                    <option value="multi">Multiple choice</option>
                    <option value="fill_blank">Fill in the blank</option>
                    <option value="short_answer">Short answer</option>
                  </select>
                  <button onClick={closeEditor} aria-label="Close" className={"shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 " + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"}><IconX size={15} /></button>
                </div>
              </div>

              <div className="px-5 py-4 space-y-5 overflow-y-auto">
                <BilingualField
                  id={`${uid}-${q.id}-text`}
                  label="Question" placeholder="Type here…" hiPlaceholder="अपने आप बनेगा…"
                  value={q.text} valueHi={q.textHi || ""}
                  onChange={(v) => { updateQuestion(q.id, { text: v }); scheduleTranslate(`${q.id}_text`, v, (hi) => updateQuestion(q.id, { textHi: hi })); }}
                  onChangeHi={(v) => updateQuestion(q.id, { textHi: v })}
                />

                {type === "single" && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Options</h4>
                    <p className="mt-0.5 mb-2 text-xs text-gray-500">Pick the one correct option — staff must choose this to pass.</p>
                    <div className="space-y-3">
                      {q.options.map((opt, oi) => {
                        const isCorrect = q.correctIndex === oi;
                        return (
                        <div key={oi}>
                          <div className="flex items-center justify-between gap-2 min-h-8 mb-1">
                            <label className="flex items-center gap-2 min-h-10 sm:min-h-8 text-xs font-semibold text-gray-700 cursor-pointer">
                              <input type="radio" name={`${uid}-${q.id}-correct`} checked={isCorrect} onChange={() => updateQuestion(q.id, { correctIndex: oi })}
                                aria-label={`Option ${letterFor(oi)} is correct`}
                                className="w-4 h-4 border-gray-300 accent-blue-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1" />
                              Option {letterFor(oi)}{isCorrect && <CorrectPill />}
                            </label>
                            {q.options.length > 2 && (
                              <button onClick={() => removeOption(q.id, oi)} aria-label={`Remove option ${letterFor(oi)}`} title="Remove option" className={iconBtnSmall}><IconX size={13} /></button>
                            )}
                          </div>
                          <BilingualField compact ariaLabel={`Option ${letterFor(oi)}`} placeholder="Type here…" hiPlaceholder="हिंदी (अपने आप)"
                            value={opt} valueHi={(q.optionsHi || [])[oi] || ""}
                            onChange={(v) => { updateOption(q.id, oi, v); scheduleTranslate(`${q.id}_opt_${oi}`, v, (hi) => updateOptionHi(q.id, oi, hi)); }}
                            onChangeHi={(v) => updateOptionHi(q.id, oi, v)}
                          />
                        </div>
                        );
                      })}
                    </div>
                    <button onClick={() => addOption(q.id)} className={btnGhost + " mt-2"}>
                      <IconPlusCircle size={15} /> Add option
                    </button>
                  </div>
                )}

                {type === "multi" && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Options</h4>
                    <p className="mt-0.5 mb-2 text-xs text-gray-500">Tick every correct option — staff must pick exactly these to pass.</p>
                    <div className="space-y-3">
                      {q.options.map((opt, oi) => {
                        const isCorrect = (q.correctIndexes || []).includes(oi);
                        return (
                        <div key={oi}>
                          <div className="flex items-center justify-between gap-2 min-h-8 mb-1">
                            <label className="flex items-center gap-2 min-h-10 sm:min-h-8 text-xs font-semibold text-gray-700 cursor-pointer">
                              <input type="checkbox" checked={isCorrect} onChange={() => toggleMultiCorrect(q.id, oi)}
                                aria-label={`Option ${letterFor(oi)} is correct`}
                                className="w-4 h-4 rounded border-gray-300 accent-blue-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1" />
                              Option {letterFor(oi)}{isCorrect && <CorrectPill />}
                            </label>
                            {q.options.length > 2 && (
                              <button onClick={() => removeOption(q.id, oi)} aria-label={`Remove option ${letterFor(oi)}`} title="Remove option" className={iconBtnSmall}><IconX size={13} /></button>
                            )}
                          </div>
                          <BilingualField compact ariaLabel={`Option ${letterFor(oi)}`} placeholder="Type here…" hiPlaceholder="हिंदी (अपने आप)"
                            value={opt} valueHi={(q.optionsHi || [])[oi] || ""}
                            onChange={(v) => { updateOption(q.id, oi, v); scheduleTranslate(`${q.id}_opt_${oi}`, v, (hi) => updateOptionHi(q.id, oi, hi)); }}
                            onChangeHi={(v) => updateOptionHi(q.id, oi, v)}
                          />
                        </div>
                        );
                      })}
                    </div>
                    <button onClick={() => addOption(q.id)} className={btnGhost + " mt-2"}>
                      <IconPlusCircle size={15} /> Add option
                    </button>
                  </div>
                )}

                {type === "fill_blank" && (
                  <div>
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                      Accepted answers
                      <span className="text-gray-400" role="img" aria-label="Any of these are accepted, ignoring case and extra spaces." title="Any of these are accepted, ignoring case and extra spaces."><IconInfo size={14} /></span>
                    </h4>
                    <p className="mt-0.5 mb-2 text-xs text-gray-500">Any of these are accepted (English or Hindi).</p>
                    <div className="space-y-3">
                      {(q.acceptedAnswers || [""]).map((a, ai) => (
                        <div key={ai} className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <BilingualField compact ariaLabel={`Accepted answer ${ai + 1}`} placeholder="Accepted answer" hiPlaceholder="हिंदी (अपने आप)"
                              value={a} valueHi={(q.acceptedAnswersHi || [])[ai] || ""}
                              onChange={(v) => { updateAcceptedAnswer(q.id, ai, v); scheduleTranslate(`${q.id}_acc_${ai}`, v, (hi) => updateAcceptedAnswerHi(q.id, ai, hi)); }}
                              onChangeHi={(v) => updateAcceptedAnswerHi(q.id, ai, v)}
                            />
                          </div>
                          {q.acceptedAnswers.length > 1 && (
                            <button onClick={() => removeAcceptedAnswer(q.id, ai)} aria-label={`Remove accepted answer ${ai + 1}`} title="Remove" className={iconBtnSmall + " mt-0.5 sm:mt-1"}><IconX size={13} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => addAcceptedAnswer(q.id)} className={btnGhost + " mt-2"}>
                      <IconPlusCircle size={15} /> Add another accepted answer
                    </button>
                  </div>
                )}

                {type === "short_answer" && (
                  <div className="flex items-start gap-2 rounded-xl bg-gray-50 ring-1 ring-gray-100 px-3 py-2.5 text-xs text-gray-600">
                    <span className="mt-px text-gray-400"><IconInfo size={14} /></span>
                    <p>Staff write a free response — there's no right or wrong text to set here, they just need to answer.</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
                <button onClick={closeEditor} className={btnSecondary}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sticky, not just a footer row: with several questions the button used to scroll away
          the moment you started editing one lower down, so saving meant scrolling all the way
          back up. Stays reachable on both a long phone screen and a long desktop one. */}
      <div className="sticky bottom-0 z-10 rounded-2xl bg-white/95 backdrop-blur ring-1 ring-gray-200/70 shadow-sm px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <button onClick={addQuestion} className={btnSecondary}>
          <IconPlusCircle size={16} /> Add {draft.questions.length ? "another " : ""}question
        </button>
        <div className="flex items-center gap-3 ml-auto">
          <span aria-live="polite" className="text-xs font-medium">
            {saveState === "saving" && (
              <span className="inline-flex items-center gap-2 text-gray-500">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" aria-hidden="true" /> Saving…
              </span>
            )}
            {saveState === "saved" && <span className="inline-flex items-center gap-1.5 text-green-700"><IconCheck size={13} /> Saved</span>}
            {saveState === "error" && <span className="inline-flex items-center gap-1.5 text-red-700"><IconAlert size={13} /> Couldn't save — try again</span>}
          </span>
          <button onClick={save} disabled={saveState === "saving"} className={btnPrimary}>
            <IconSave size={16} /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

const typeLabel = { single: "Single choice", multi: "Multiple choice", fill_blank: "Fill in the blank", short_answer: "Short answer" };

// Compact one-line summary — the list on the main page is these, not full inline editors. Keeps
// the page scannable with 10+ questions; the full editor opens in a modal on Edit.
function QuestionSummaryRow({ q, qi, onEdit, onDelete }) {
  const type = q.type || "single";
  const preview = (q.text || "").trim() || "Untitled question — tap Edit to fill in";
  const metaBits = [];
  if (type === "single" || type === "multi") {
    const n = q.options?.length || 0;
    const correctCount = type === "multi" ? (q.correctIndexes?.length || 0) : (n > 0 ? 1 : 0);
    metaBits.push(`${n} option${n === 1 ? "" : "s"}`);
    metaBits.push(`${correctCount} correct`);
  } else if (type === "fill_blank") {
    const n = q.acceptedAnswers?.length || 0;
    metaBits.push(`${n} accepted answer${n === 1 ? "" : "s"}`);
  } else {
    metaBits.push("Open response");
  }
  return (
    <li className="rounded-xl ring-1 ring-gray-200 bg-white hover:ring-gray-300 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="shrink-0 w-8 h-8 rounded-xl bg-blue-100 text-blue-600 text-sm font-bold flex items-center justify-center" aria-hidden="true">{qi + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{typeLabel[type]}</span>
            <span className="text-xs text-gray-500 tabular-nums">{metaBits.join(" · ")}</span>
          </div>
          <p className={"mt-0.5 text-sm truncate " + ((q.text || "").trim() ? "text-gray-900" : "text-gray-400 italic")}>{preview}</p>
        </div>
        <button onClick={onEdit} className="shrink-0 h-9 px-3 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Edit</button>
        <button onClick={onDelete} aria-label={`Delete question ${qi + 1}`} title="Delete question"
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><IconTrash size={15} /></button>
      </div>
    </li>
  );
}

function CorrectPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 ring-1 ring-green-200 px-2 py-0.5 text-xs font-medium text-green-700">
      <IconCheck size={11} /> Correct
    </span>
  );
}

// One source (English/Hinglish) input with its Hindi translation shown directly below — the one
// repeating shape behind every question, option, and accepted answer in this panel. The Hindi
// input is never disabled: auto-fill is a starting point the admin can freely overwrite, and a
// translation hiccup (translateToHindi resolving null) must not leave them stuck with no way in.
// Each input carries a small EN / हिं tag so a compact (unlabelled) pair still reads as a pair;
// a labelled field ties its labels to the inputs via `id`, a compact one names them by `ariaLabel`.
function BilingualField({ id, label, ariaLabel, value, valueHi, onChange, onChangeHi, placeholder, hiPlaceholder, compact = false }) {
  const tag = "absolute left-2.5 top-1/2 -translate-y-1/2 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 pointer-events-none";
  return (
    <div>
      {label && <label htmlFor={`${id}-en`} className="block text-xs font-medium text-gray-700 mb-1.5">{label} (English)</label>}
      <div className="relative">
        <span className={tag} aria-hidden="true">EN</span>
        <input id={label ? `${id}-en` : undefined} aria-label={label ? undefined : `${ariaLabel} (English)`}
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className={inputCls + " bg-white"} />
      </div>
      {label && <label htmlFor={`${id}-hi`} className="block text-xs font-medium text-gray-700 mb-1.5 mt-3">{label} (Hindi)</label>}
      <div className={"relative " + (label ? "" : "mt-1.5")}>
        <span className={tag} aria-hidden="true">हिं</span>
        <input id={label ? `${id}-hi` : undefined} aria-label={label ? undefined : `${ariaLabel} (Hindi)`}
          value={valueHi} onChange={(e) => onChangeHi(e.target.value)} placeholder={hiPlaceholder} dir="auto" lang="hi"
          className={inputCls + " bg-gray-50/60 focus:bg-white"} />
      </div>
    </div>
  );
}
