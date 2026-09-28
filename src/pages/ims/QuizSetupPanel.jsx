import { useEffect, useState } from "react";
import { Field, Input, Tabs } from "../../components/ui";
import { ATTENDANCE_QUIZ_DEPTS, ATTENDANCE_QUIZ_DEPT_ICON } from "../../lib/ims/attendance";

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
// ═══════════════════════════════════════════════════════════════════════════
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

  // Another admin (or another tab) can change this while the panel is open — settings arrives
  // live via realtime, so pick up their edit rather than silently overwriting it on next Save.
  useEffect(() => {
    setDraft(settings?.attendanceTrainingByDept?.[dept] || { videoUrl: "", questions: [] });
    // eslint-disable-next-line -- react-hooks/exhaustive-deps is stubbed repo-wide (see CLAUDE.md); dept is a prop, not state, so it can't itself go stale here
  }, [settings?.attendanceTrainingByDept?.[dept]]);

  function addQuestion() {
    setDraft((d) => ({ ...d, questions: [...d.questions, { id: "q" + Date.now(), type: "single", text: "", options: ["", ""], correctIndex: 0 }] }));
  }
  function updateQuestion(id, patch) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  }
  function removeQuestion(id) {
    setDraft((d) => ({ ...d, questions: d.questions.filter((q) => q.id !== id) }));
  }
  // Switching type reshapes the question to that type's own fields — `text` carries over (it's
  // type-agnostic), everything else resets to a sensible blank rather than leaving, say, a
  // `correctIndex` sitting unused on a fill-in-the-blank question.
  function setQuestionType(id, type) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) => {
        if (q.id !== id) return q;
        const base = { id: q.id, type, text: q.text };
        if (type === "single") return { ...base, options: ["", ""], correctIndex: 0 };
        if (type === "multi") return { ...base, options: ["", ""], correctIndexes: [] };
        if (type === "fill_blank") return { ...base, acceptedAnswers: [""] };
        return base; // short_answer has no correct-answer fields at all
      }),
    }));
  }
  function updateOption(qid, oi, text) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, options: q.options.map((o, i) => (i === oi ? text : o)) } : q)) }));
  }
  function addOption(qid) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, options: [...q.options, ""] } : q)) }));
  }
  // Shared by single and multi choice — which correct-answer field to shift depends on the
  // question's own type.
  function removeOption(qid, oi) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) => {
        if (q.id !== qid) return q;
        const options = q.options.filter((_, i) => i !== oi);
        if (q.type === "multi") {
          const correctIndexes = (q.correctIndexes || []).filter((i) => i !== oi).map((i) => (i > oi ? i - 1 : i));
          return { ...q, options, correctIndexes };
        }
        const correctIndex = q.correctIndex === oi ? 0 : q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex;
        return { ...q, options, correctIndex };
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
  function addAcceptedAnswer(qid) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, acceptedAnswers: [...q.acceptedAnswers, ""] } : q)) }));
  }
  function removeAcceptedAnswer(qid, ai) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? { ...q, acceptedAnswers: q.acceptedAnswers.filter((_, i) => i !== ai) } : q)) }));
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
    <div className="mt-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 text-left">
      <Field label={`YouTube video (shown before every ${dept} punch-in)`}>
        <Input value={draft.videoUrl} onChange={(e) => setDraft((d) => ({ ...d, videoUrl: e.target.value }))} placeholder="Paste any YouTube link" />
      </Field>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 font-medium">Questions asked after the video</span>
          <button onClick={addQuestion} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">+ Add question</button>
        </div>
        {draft.questions.length === 0 && <p className="text-xs text-gray-400">No questions yet — staff just watch the video.</p>}
        <div className="space-y-4">
          {draft.questions.map((q, qi) => {
            const type = q.type || "single";
            return (
            <div key={q.id} className="border rounded-xl p-3">
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-400 font-semibold mt-2">{qi + 1}.</span>
                <input value={q.text} onChange={(e) => updateQuestion(q.id, { text: e.target.value })} placeholder="Question text"
                  className="flex-1 border rounded-lg px-2 py-1.5 text-sm" />
                <select value={type} onChange={(e) => setQuestionType(q.id, e.target.value)}
                  className="text-xs border rounded-lg px-1.5 py-1.5 bg-white text-gray-600">
                  <option value="single">Single choice</option>
                  <option value="multi">Multiple choice</option>
                  <option value="fill_blank">Fill in the blank</option>
                  <option value="short_answer">Short answer</option>
                </select>
                <button onClick={() => removeQuestion(q.id)} className="text-gray-300 hover:text-red-500 text-sm px-1" title="Remove question">✕</button>
              </div>

              {type === "single" && (
                <div className="mt-2 ml-5 space-y-1.5">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input type="radio" name={`correct_${dept}_${q.id}`} checked={q.correctIndex === oi}
                        onChange={() => updateQuestion(q.id, { correctIndex: oi })} title="Correct answer" />
                      <input value={opt} onChange={(e) => updateOption(q.id, oi, e.target.value)} placeholder={`Option ${oi + 1}`}
                        className="flex-1 border rounded-lg px-2 py-1 text-sm" />
                      {q.options.length > 2 && (
                        <button onClick={() => removeOption(q.id, oi)} className="text-gray-300 hover:text-red-500 text-xs" title="Remove option">✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => addOption(q.id)} className="text-xs text-gray-400 hover:text-gray-600">+ Add option</button>
                </div>
              )}

              {type === "multi" && (
                <div className="mt-2 ml-5 space-y-1.5">
                  <p className="text-[11px] text-gray-400">Check every correct option — staff must pick exactly these to pass.</p>
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input type="checkbox" checked={(q.correctIndexes || []).includes(oi)}
                        onChange={() => toggleMultiCorrect(q.id, oi)} title="Correct answer" />
                      <input value={opt} onChange={(e) => updateOption(q.id, oi, e.target.value)} placeholder={`Option ${oi + 1}`}
                        className="flex-1 border rounded-lg px-2 py-1 text-sm" />
                      {q.options.length > 2 && (
                        <button onClick={() => removeOption(q.id, oi)} className="text-gray-300 hover:text-red-500 text-xs" title="Remove option">✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => addOption(q.id)} className="text-xs text-gray-400 hover:text-gray-600">+ Add option</button>
                </div>
              )}

              {type === "fill_blank" && (
                <div className="mt-2 ml-5 space-y-1.5">
                  <p className="text-[11px] text-gray-400">Any of these are accepted, ignoring case and extra spaces.</p>
                  {(q.acceptedAnswers || [""]).map((a, ai) => (
                    <div key={ai} className="flex items-center gap-2">
                      <input value={a} onChange={(e) => updateAcceptedAnswer(q.id, ai, e.target.value)} placeholder="Accepted answer"
                        className="flex-1 border rounded-lg px-2 py-1 text-sm" />
                      {q.acceptedAnswers.length > 1 && (
                        <button onClick={() => removeAcceptedAnswer(q.id, ai)} className="text-gray-300 hover:text-red-500 text-xs" title="Remove">✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => addAcceptedAnswer(q.id)} className="text-xs text-gray-400 hover:text-gray-600">+ Add another accepted spelling</button>
                </div>
              )}

              {type === "short_answer" && (
                <p className="mt-2 ml-5 text-xs text-gray-400">
                  Staff write a free response — there's no right or wrong text to set here, they just need to answer.
                </p>
              )}
            </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Save changes</button>
        {flash && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
      </div>
    </div>
  );
}
