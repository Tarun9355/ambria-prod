import { useEffect, useRef, useState } from "react";
import { Tabs } from "../../components/ui";
import { ATTENDANCE_QUIZ_DEPTS, ATTENDANCE_QUIZ_DEPT_ICON } from "../../lib/ims/attendance";
import { translateToHindi } from "../../lib/ims/translateHindi";
import { IconYoutubeMark, IconLink, IconTrash, IconInfo, IconPlusCircle, IconSave, IconX, IconPlay } from "../../components/icons.jsx";
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

export default function QuizSetupPanel({ settings, setSettings }) {
  const [dept, setDept] = useState(ATTENDANCE_QUIZ_DEPTS[0]);

  return (
    <div className="mt-3">
      <Tabs
        tabs={ATTENDANCE_QUIZ_DEPTS.map((d) => ({ id: d, label: `${ATTENDANCE_QUIZ_DEPT_ICON[d]} ${d}` }))}
        active={dept}
        onChange={setDept}
      />
      {/* Keyed on dept so each department gets a fresh draft/flash state instead of one editor
          instance quietly carrying stale local state across a department switch. */}
      <DeptQuizEditor key={dept} dept={dept} settings={settings} setSettings={setSettings} />
    </div>
  );
}

function DeptQuizEditor({ dept, settings, setSettings }) {
  const saved = settings?.attendanceTrainingByDept?.[dept] || { videoUrl: "", questions: [] };
  const [draft, setDraft] = useState(saved);
  const [flash, setFlash] = useState(false);
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

  function addQuestion() {
    setDraft((d) => ({ ...d, questions: [...d.questions, { id: "q" + Date.now(), type: "single", text: "", textHi: "", options: ["", ""], optionsHi: ["", ""], correctIndex: 0 }] }));
  }
  function updateQuestion(id, patch) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  }
  function removeQuestion(id) {
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
    setSettings((s) => ({ ...s, attendanceTrainingByDept: { ...(s.attendanceTrainingByDept || {}), [dept]: cleaned } }));
    setFlash(true);
    setTimeout(() => setFlash(false), 2000);
  }

  return (
    <div className="mt-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 sm:p-5 text-left">
      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F5F7FF 55%, #FFFFFF 100%)" }}>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center shrink-0">
            <IconYoutubeMark size={30} />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-gray-900">YouTube Video</h3>
            <p className="text-sm text-gray-500 mt-0.5">Add the video link (shown before every {dept.toLowerCase()} punch-in)</p>
          </div>
        </div>
        {videoId && (
          <div className="mt-4 flex items-center gap-3 bg-white rounded-xl ring-1 ring-gray-200 p-2.5">
            <div className="relative w-24 sm:w-28 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
              <img src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <div className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-red-600 pl-0.5"><IconPlay size={13} /></div>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-green-600">Video added ✓</p>
              <p className="text-xs text-gray-400 truncate">{draft.videoUrl}</p>
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2.5 bg-white rounded-xl ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-indigo-300 px-4 py-3 transition">
          <span className="text-gray-400 shrink-0"><IconLink size={16} /></span>
          <input value={draft.videoUrl} onChange={(e) => setDraft((d) => ({ ...d, videoUrl: e.target.value }))}
            placeholder="Paste any YouTube link" className="flex-1 min-w-0 outline-none text-sm text-gray-700 bg-transparent" />
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white shadow-sm">
            English/Hinglish → हिंदी
          </span>
          <span className="text-sm text-gray-500">
            Questions after video · <span className="inline-flex items-center justify-center min-w-[1.4em] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">{draft.questions.length}</span>
          </span>
        </div>

        {draft.questions.length === 0 && <p className="text-xs text-gray-400 mb-3">No questions yet — add the first one below.</p>}
        <div className="space-y-4">
          {draft.questions.map((q, qi) => {
            const type = q.type || "single";
            return (
            <div key={q.id} className="rounded-xl ring-1 ring-gray-100 shadow-sm p-3.5 sm:p-4 transition duration-200 hover:shadow-xl hover:shadow-gray-400/30 hover:-translate-y-0.5">
              {/* Side by side from lg: up — the question and its answers used to stack full-width
                  the whole way to a desktop monitor, leaving most of a wide screen empty. Still
                  stacks on phone/tablet, where there isn't room for two columns to breathe. */}
              <div className="lg:grid lg:grid-cols-2 lg:gap-x-8">
              <div>
              <div className="flex items-center gap-2.5 mb-4">
                <span className="shrink-0 w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 text-sm font-bold flex items-center justify-center">{qi + 1}</span>
                <select value={type} onChange={(e) => setQuestionType(q.id, e.target.value)}
                  className="text-sm font-semibold border border-gray-200 rounded-xl pl-3 pr-2 py-2 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 min-w-0">
                  <option value="single">Single choice</option>
                  <option value="multi">Multiple choice</option>
                  <option value="fill_blank">Fill in the blank</option>
                  <option value="short_answer">Short answer</option>
                </select>
                <span className="flex-1" />
                <button onClick={() => removeQuestion(q.id)}
                  className="shrink-0 text-gray-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition" title="Remove question"><IconTrash size={16} /></button>
              </div>

              <BilingualField
                label="Question" placeholder="Type here…" hiPlaceholder="अपने आप बनेगा…"
                value={q.text} valueHi={q.textHi || ""}
                onChange={(v) => { updateQuestion(q.id, { text: v }); scheduleTranslate(`${q.id}_text`, v, (hi) => updateQuestion(q.id, { textHi: hi })); }}
                onChangeHi={(v) => updateQuestion(q.id, { textHi: v })}
              />
              </div>

              <div className="mt-4 lg:mt-0 lg:pl-1">
              {type === "single" && (
                <div>
                  <span className="text-sm font-bold text-gray-800 block mb-2">Options</span>
                  {/* 2 columns read fine at the card's full mobile/tablet width, but once the card
                      itself splits in half at lg: (see the wrapper above) that same 2-up grid inside
                      an already-halved column got cramped — drop back to 1 column exactly when the
                      card does, so an option never has less room than the mobile view had. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                    {q.options.map((opt, oi) => (
                      <div key={oi}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-gray-600">
                            Option {letterFor(oi)}{q.correctIndex === oi && <span className="text-green-600"> · correct</span>}
                          </span>
                          {q.options.length > 2 && (
                            <button onClick={() => removeOption(q.id, oi)} className="text-gray-300 hover:text-red-500 hover:bg-red-50 p-1 -mr-1 rounded-md transition" title="Remove option"><IconX size={12} /></button>
                          )}
                        </div>
                        <BilingualField compact placeholder="Type here…" hiPlaceholder="हिंदी (अपने आप)"
                          value={opt} valueHi={(q.optionsHi || [])[oi] || ""}
                          onChange={(v) => { updateOption(q.id, oi, v); scheduleTranslate(`${q.id}_opt_${oi}`, v, (hi) => updateOptionHi(q.id, oi, hi)); }}
                          onChangeHi={(v) => updateOptionHi(q.id, oi, v)}
                        />
                      </div>
                    ))}
                  </div>
                  <button onClick={() => addOption(q.id)}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-1.5 transition">
                    <IconPlusCircle size={14} /> Add option
                  </button>

                  <div className="mt-4">
                    <span className="text-xs font-semibold text-gray-500 block mb-1">Correct answer</span>
                    <select value={q.correctIndex} onChange={(e) => updateQuestion(q.id, { correctIndex: Number(e.target.value) })}
                      className="border border-gray-200 rounded-lg px-2 py-2 sm:py-1.5 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                      {q.options.map((_, oi) => <option key={oi} value={oi}>Option {letterFor(oi)}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {type === "multi" && (
                <div>
                  <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
                    <span className="text-sm font-bold text-gray-800">Options</span>
                    <p className="text-[11px] text-gray-400">Check every correct option — staff must pick exactly these to pass.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                    {q.options.map((opt, oi) => (
                      <div key={oi}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 cursor-pointer">
                            <input type="checkbox" checked={(q.correctIndexes || []).includes(oi)} onChange={() => toggleMultiCorrect(q.id, oi)} />
                            Option {letterFor(oi)}{(q.correctIndexes || []).includes(oi) && <span className="text-green-600"> · correct</span>}
                          </label>
                          {q.options.length > 2 && (
                            <button onClick={() => removeOption(q.id, oi)} className="text-gray-300 hover:text-red-500 hover:bg-red-50 p-1 -mr-1 rounded-md transition" title="Remove option"><IconX size={12} /></button>
                          )}
                        </div>
                        <BilingualField compact placeholder="Type here…" hiPlaceholder="हिंदी (अपने आप)"
                          value={opt} valueHi={(q.optionsHi || [])[oi] || ""}
                          onChange={(v) => { updateOption(q.id, oi, v); scheduleTranslate(`${q.id}_opt_${oi}`, v, (hi) => updateOptionHi(q.id, oi, hi)); }}
                          onChangeHi={(v) => updateOptionHi(q.id, oi, v)}
                        />
                      </div>
                    ))}
                  </div>
                  <button onClick={() => addOption(q.id)}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-1.5 transition">
                    <IconPlusCircle size={14} /> Add option
                  </button>
                </div>
              )}

              {type === "fill_blank" && (
                <div>
                  <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
                    <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                      Accepted answers <span className="text-gray-300" title="Any of these are accepted, ignoring case and extra spaces."><IconInfo size={14} /></span>
                    </span>
                    <p className="text-[11px] text-gray-400">Any of these are accepted (English or Hindi).</p>
                  </div>
                  <div className="space-y-3">
                    {(q.acceptedAnswers || [""]).map((a, ai) => (
                      <div key={ai} className="flex items-start gap-2">
                        <div className="flex-1">
                          <BilingualField compact placeholder="Accepted answer" hiPlaceholder="हिंदी (अपने आप)"
                            value={a} valueHi={(q.acceptedAnswersHi || [])[ai] || ""}
                            onChange={(v) => { updateAcceptedAnswer(q.id, ai, v); scheduleTranslate(`${q.id}_acc_${ai}`, v, (hi) => updateAcceptedAnswerHi(q.id, ai, hi)); }}
                            onChangeHi={(v) => updateAcceptedAnswerHi(q.id, ai, v)}
                          />
                        </div>
                        {q.acceptedAnswers.length > 1 && (
                          <button onClick={() => removeAcceptedAnswer(q.id, ai)} className="text-gray-300 hover:text-red-500 hover:bg-red-50 p-1.5 mt-1 rounded-md transition" title="Remove"><IconX size={13} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => addAcceptedAnswer(q.id)}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-1.5 transition">
                    <IconPlusCircle size={14} /> Add another accepted answer
                  </button>
                </div>
              )}

              {type === "short_answer" && (
                <p className="text-xs text-gray-400">
                  Staff write a free response — there's no right or wrong text to set here, they just need to answer.
                </p>
              )}
              </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Sticky, not just a footer row: with several questions the button used to scroll away
          the moment you started editing one lower down, so saving meant scrolling all the way
          back up. Stays reachable on both a long phone screen and a long desktop one. */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 mt-5 px-4 sm:px-5 py-3 bg-white/95 backdrop-blur border-t rounded-b-2xl flex items-center justify-between flex-wrap gap-3">
        <button onClick={addQuestion}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl px-4 py-2.5 sm:py-2 transition">
          <IconPlusCircle size={16} /> Add another question
        </button>
        <div className="flex items-center gap-3">
          {flash && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
          <button onClick={save}
            className="inline-flex items-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition">
            <IconSave size={16} /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// One source (English/Hinglish) input with its Hindi translation shown directly below — the one
// repeating shape behind every question, option, and accepted answer in this panel. The Hindi
// input is never disabled: auto-fill is a starting point the admin can freely overwrite, and a
// translation hiccup (translateToHindi resolving null) must not leave them stuck with no way in.
function BilingualField({ label, value, valueHi, onChange, onChangeHi, placeholder, hiPlaceholder, compact = false }) {
  // text-base (16px) on phone, text-sm (14px) from sm: up — anything smaller than 16px makes iOS
  // Safari zoom the whole page in the instant this input gets focus, which then has to be manually
  // pinched back out to keep typing. Desktop keeps the tighter size, phone gets the safe one.
  const size = compact ? "px-2 py-2 sm:py-1.5 text-base sm:text-sm" : "px-3 py-2.5 sm:py-2 text-base sm:text-sm";
  const ring = "focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300";
  return (
    <div>
      {label && <label className="text-xs font-semibold text-gray-600 block mb-1">{label} (English)</label>}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={"w-full border border-gray-200 rounded-lg transition " + ring + " " + size} />
      {!compact && (
        <p className="text-[10px] text-gray-400 mt-1">
          Type in English or Hinglish (e.g. 'theek hai') — Hindi appears below.
        </p>
      )}
      {label && <label className="text-xs font-semibold text-gray-600 block mb-1 mt-2">{label} (Hindi)</label>}
      <input value={valueHi} onChange={(e) => onChangeHi(e.target.value)} placeholder={hiPlaceholder}
        className={"w-full border border-gray-200 rounded-lg text-gray-700 mt-1 transition " + ring + " " + size} dir="auto" />
    </div>
  );
}
