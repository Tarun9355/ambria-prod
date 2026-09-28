import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uploadToStorage, compressImageForUpload, STORAGE_FOLDERS } from "../../lib/storage";
import { checkFaceInPhoto, watchFaceInVideo } from "../../lib/faceCheck";
import {
  todayStr, newPunchId, fetchDayPunches, insertPunch, currentState, gradeQuiz, attendanceQuizDept,
  fetchMonthPunches, groupPunchesByDate, dayHours, dayStatus, punchLabel, punchLocationLabel,
  getCurrentCoords, resolvePunchLocation, reverseGeocode,
} from "../../lib/ims/attendance";
import AttendanceVideoPlayer, { extractYouTubeId } from "./AttendanceVideoPlayer.jsx";
import AttendanceAdminLog from "./AttendanceAdminLog.jsx";
import QuizSetupPanel from "./QuizSetupPanel.jsx";
import AttendanceLocationsPanel from "./AttendanceLocationsPanel.jsx";
import {
  IconUsers, IconClockAlert, IconHourglass, IconPlay, IconStop, IconClipboard, IconBook, IconPin,
  IconCamera, IconList,
} from "../../components/icons.jsx";

// ═══════════════════════════════════════════════════════════════════════════
// ATTENDANCE — punch IN: watch a training video first (no skipping ahead, see
// AttendanceVideoPlayer.jsx), then a short quiz on it if one's set, and only THEN
// does the photo step appear — the photo is what actually punches you in, gated
// on the on-device face check. Punch OUT skips straight to that same photo step;
// the briefing belongs to arriving, not leaving.
//
// The video + quiz shown are the puncher's own BUILD DEPARTMENT's, set by an admin
// in the Quiz Setup tab (QuizSetupTab.jsx) — see attendanceQuizDept in lib/ims/
// attendance.js for exactly which users get one (and which don't).
//
// See src/lib/faceCheck.js for exactly what "verified" does and doesn't catch, and
// supabase/migrations/030_attendance.sql for why this is an append-only event log
// rather than one mutable row per user per day.
//
// ── LAYOUT (owner-requested, matching a reference dashboard mockup) ──
// A wide two-column page on desktop — today's punch timeline on the left, this
// month's stat cards + calendar on the right — stacking to one column on narrow
// screens. The reference's own "Present / Incomplete / Hours" cards are captioned
// as a live company-wide "today" dashboard (a bigger, separate feature this app
// doesn't have); the numbers here are the real thing this page already computes —
// this account's own punches for the month — so the subtitles say that honestly
// instead of copying captions that would describe data this doesn't have.
// ═══════════════════════════════════════════════════════════════════════════

const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };

// Fixed, fully-written-out class strings per variant — NOT built by concatenating a colour
// variable into a template string. Tailwind's build only ever includes classes it can see
// literally in source; a dynamically assembled "bg-" + colour + "-100" would vanish from the
// shipped CSS the first time nothing else on the page happens to use that exact class already.
const STAT_VARIANTS = {
  green: { badge: "bg-green-50 text-green-600", value: "text-gray-900" },
  amber: { badge: "bg-amber-50 text-amber-600", value: "text-gray-900" },
  blue: { badge: "bg-blue-50 text-blue-600", value: "text-gray-900" },
};

function StatCard({ variant, icon, label, value, sub }) {
  const v = STAT_VARIANTS[variant];
  return (
    <div className="rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm p-3 sm:p-4 transition duration-200 hover:shadow-xl hover:shadow-gray-400/30 hover:-translate-y-0.5">
      <div className="flex items-center justify-between mb-2 sm:mb-3 gap-1">
        <div className="text-[9px] sm:text-[10px] font-semibold text-gray-400 uppercase tracking-wide truncate">{label}</div>
        <div className={"w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 " + v.badge}>{icon}</div>
      </div>
      <div className={"text-xl sm:text-2xl font-bold leading-none " + v.value}>{value}</div>
      <div className="text-[10px] sm:text-[11px] text-gray-400 mt-1.5">{sub}</div>
    </div>
  );
}

export default function AttendanceTab({ authUser, settings, setSettings, users }) {
  const isAdmin = (authUser?.role || "").toLowerCase() === "admin" || authUser?.id === "u_admin";
  // null when this user has no single matching build department — same as no video configured
  // (see attendanceQuizDept's own comment for exactly who that covers).
  const myQuizDept = attendanceQuizDept(authUser);
  const myTraining = (myQuizDept && settings?.attendanceTrainingByDept?.[myQuizDept]) || { videoUrl: "", questions: [] };
  const [dayPunches, setDayPunches] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [flow, setFlow] = useState(null);
  // null | "quiz" | "log" | "location" — which admin sub-view (if any) has taken over the page.
  const [adminView, setAdminView] = useState(null);
  // Mobile only — collapsed by default so the phone view opens on the stat cards + calendar, not
  // a long scrolling list of today's punches; desktop always shows it expanded regardless (see the
  // "hidden lg:block" pairing below, the standard Tailwind way to make a collapse mobile-only).
  const [todayOpen, setTodayOpen] = useState(false);
  const savingRef = useRef(false);

  // ── Live camera (photo step) ──
  // `<input capture>` only launches a camera on mobile — desktop Chrome/Edge on Windows just
  // opens a plain file picker, which is what sent the owner to File Explorer instead of a photo.
  // getUserMedia is the one API that actually opens a live camera on desktop too, so this is a
  // real in-page camera with a "Take Photo" button, not a file-picker trigger. The file input
  // stays as a fallback for when the camera API is missing or permission is denied.
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraError, setCameraError] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const showLiveCamera = flow?.step === "photo" && !flow.photoDataUrl && !flow.checking && !cameraError;

  useEffect(() => {
    if (!showLiveCamera) return;
    let cancelled = false;
    setVideoReady(false);
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("unsupported"); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err) => { if (!cancelled) setCameraError(err?.name === "NotAllowedError" ? "denied" : "unsupported"); });
    // Runs on every step change too (not just open/close) — that's what makes "retake" restart
    // the camera: failing the face check clears photoDataUrl, showLiveCamera goes true again.
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [showLiveCamera]);

  // Live face presence, polled off the video feed — purely to colour the oval and gate the Take
  // Photo button. The real gate (checkFaceInPhoto) still runs once on the actual captured frame;
  // this loop just stops someone tapping the shutter at a phone pointed at the ceiling.
  const [faceInOval, setFaceInOval] = useState(false);
  useEffect(() => {
    if (!showLiveCamera || !videoReady) { setFaceInOval(false); return; }
    const stop = watchFaceInVideo(videoRef.current, setFaceInOval);
    return () => { stop(); setFaceInOval(false); };
  }, [showLiveCamera, videoReady]);

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !faceInOval) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    canvas.toBlob((blob) => {
      if (!blob) return;
      runCapturedPhoto(new File([blob], "punch.jpg", { type: "image/jpeg" }), canvas.toDataURL("image/jpeg", 0.9));
    }, "image/jpeg", 0.9);
  }

  useEffect(() => {
    if (!authUser?.id) { setLoadingStatus(false); return; }
    let active = true;
    setLoadingStatus(true);
    fetchDayPunches(authUser.id, todayStr())
      .then((rows) => { if (active) { setDayPunches(rows); setLoadError(""); } })
      .catch((e) => { if (active) setLoadError(e.message || "Couldn't load today's attendance"); })
      .finally(() => { if (active) setLoadingStatus(false); });
    return () => { active = false; };
  }, [authUser?.id]);

  // Esc + backdrop-scroll-lock while the flow is open. Bound once per open/close, not per state
  // tick inside it (flow is a new object on every step change) — a ref carries the live step so
  // the listener still knows not to let Esc cancel a save in flight.
  const flowRef = useRef(flow);
  flowRef.current = flow;
  useEffect(() => {
    if (!flow) return;
    const onKey = (e) => { if (e.key === "Escape" && flowRef.current?.step !== "saving") setFlow(null); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line -- react-hooks/exhaustive-deps is stubbed repo-wide (see CLAUDE.md); intentionally keyed on open/close only
  }, [Boolean(flow)]);

  function startPunch(type) {
    const gated = type === "in"; // the briefing runs on every punch-in, not just the day's first
    const questions = gated ? (myTraining.questions || []) : [];
    setFlow({
      type,
      // Punch-in watches the briefing FIRST, then takes the photo — the photo is what actually
      // punches you in, and it only appears once the video (and quiz, if any) are done. Punch-out
      // never has a briefing, so it goes straight to the photo, same as before.
      step: gated ? "video" : "photo",
      photoFile: null,
      photoDataUrl: null,
      checking: false,
      failMsg: "",
      needsTraining: gated,
      videoDone: false,
      videoBroken: false,
      videoRetryNote: false,
      questions,
      answers: {},
      quizWrong: null,
      quizAttempts: 0,
      // Trivially "passed" when the gate applies but nothing was configured to answer — the
      // video-watch requirement still applies on its own either way.
      quizPassed: gated && questions.length === 0 ? true : null,
      saveError: "",
      // Filled in below, whenever the browser resolves it — captured in parallel with whatever
      // step is showing (video/quiz/photo) rather than making the punch wait on it, and never
      // blocking anything if it's denied or unavailable (same fail-open principle as the camera).
      lat: null,
      lng: null,
    });
    getCurrentCoords().then((coords) => {
      setFlow((f) => f && ({ ...f, lat: coords?.lat ?? null, lng: coords?.lng ?? null }));
    });
  }

  // Shared by both capture paths: the live camera's captured frame and the fallback file input.
  // The photo is always the LAST step now (the briefing, if any, already ran before this), so a
  // pass here always moves straight to saving.
  async function runCapturedPhoto(file, dataUrl) {
    setFlow((f) => f && ({ ...f, photoFile: file, photoDataUrl: dataUrl, checking: true, failMsg: "" }));
    const res = await checkFaceInPhoto(dataUrl);
    setFlow((f) => {
      if (!f) return f; // flow was cancelled while the check was running
      if (!res.ok) return { ...f, checking: false, failMsg: res.reason, photoDataUrl: null, photoFile: null };
      return { ...f, checking: false, step: "saving" };
    });
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same photo again after a retake still fires onChange
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => runCapturedPhoto(file, ev.target.result);
    reader.readAsDataURL(file);
  }

  function submitQuiz() {
    setFlow((f) => {
      if (!f) return f;
      const { passed, wrongIds } = gradeQuiz(f.questions, f.answers);
      if (passed) return { ...f, step: "photo", quizWrong: null, quizPassed: true };
      const attempts = (f.quizAttempts || 0) + 1;
      // Two wrong tries and it's back to the video, not a third shot at the same questions —
      // a wrong answer twice in a row means the briefing didn't land, not a typo.
      if (attempts >= 2) {
        return { ...f, step: "video", videoDone: false, videoRetryNote: true, answers: {}, quizWrong: null, quizAttempts: 0 };
      }
      return { ...f, quizWrong: wrongIds, quizAttempts: attempts };
    });
  }

  // The actual save: one shot, guarded so a re-render of the "saving" step (or React 19 running
  // an effect twice) can't fire it a second time and insert two rows for one punch.
  useEffect(() => {
    if (!flow || flow.step !== "saving" || savingRef.current) return;
    savingRef.current = true;
    (async () => {
      try {
        // A fast punch-out (no video/quiz to sit through) can reach "saving" before the browser's
        // geolocation call resolves — give it up to 3s of grace rather than saving with no
        // position just because this particular punch happened to be quick. Still never blocks
        // indefinitely: past 3s it saves with whatever's there, same fail-open rule as everywhere
        // else in this flow.
        for (let waited = 0; flowRef.current?.lat == null && waited < 3000; waited += 150) {
          await new Promise((r) => setTimeout(r, 150));
        }
        const liveFlow = flowRef.current || flow;
        const resolvedLoc = resolvePunchLocation(settings?.attendanceLocations, liveFlow.lat, liveFlow.lng);
        // Outside every named location's 300m radius (but a real position WAS captured) — look up
        // an actual place name instead of leaving this punch as a bare "Unknown location".
        let locationName = resolvedLoc?.name || null;
        if (!locationName && liveFlow.lat != null && liveFlow.lng != null) {
          locationName = await reverseGeocode(liveFlow.lat, liveFlow.lng);
        }

        const compressed = await compressImageForUpload(flow.photoFile);
        const photo = await uploadToStorage(compressed, STORAGE_FOLDERS.ATTENDANCE);
        const saved = await insertPunch({
          id: newPunchId(),
          user_id: authUser.id,
          user_name: authUser.name || authUser.username || "",
          type: flow.type,
          at: new Date().toISOString(),
          date: todayStr(),
          photo,
          verified: true, // "saving" is only reached after the face check passed (or failed open — see faceCheck.js)
          quiz_passed: flow.quizPassed,
          quiz_answers: flow.needsTraining && flow.questions.length ? flow.answers : null,
          lat: liveFlow.lat,
          lng: liveFlow.lng,
          location_name: locationName,
        });
        setDayPunches((prev) => [...prev, saved]);
        setFlow(null);
      } catch (err) {
        setFlow((f) => f && ({ ...f, step: "error", saveError: err.message || "Couldn't save the punch" }));
      } finally {
        savingRef.current = false;
      }
    })();
    // eslint-disable-next-line -- see the note above the Esc effect
  }, [flow?.step]);

  if (!authUser) return <div className="text-center text-gray-400 py-20">Sign in to use Attendance.</div>;

  const state = currentState(dayPunches);
  const lastPunch = dayPunches[dayPunches.length - 1];
  const hasVideo = !!extractYouTubeId(myTraining.videoUrl);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Quiz Setup and the staff log are each a full takeover of this page, not a panel that
          expands alongside the punch card and calendar — those two plus the other admin toggle
          are hidden while either is open, and a Back button is the only way out. */}
      {!adminView && (
        <>
          {isAdmin && (
            <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 text-xs font-semibold text-gray-500">
              <button onClick={() => setAdminView("quiz")} className="flex items-center gap-1 hover:text-blue-600 transition px-1 py-0.5">
                <IconClipboard size={13} /> Quiz Setup
              </button>
              <span className="text-gray-300">/</span>
              <button onClick={() => setAdminView("log")} className="flex items-center gap-1 hover:text-blue-600 transition px-1 py-0.5">
                <IconBook size={13} /> Staff Log
              </button>
              <span className="text-gray-300">/</span>
              <button onClick={() => setAdminView("location")} className="flex items-center gap-1 hover:text-blue-600 transition px-1 py-0.5">
                <IconPin size={13} /> Manage Locations
              </button>
            </div>
          )}

          <div className="rounded-2xl p-8 sm:p-12 shadow-xl shadow-gray-300/50 ring-1 ring-black/5 transition duration-200 hover:shadow-2xl hover:shadow-gray-400/40 hover:-translate-y-0.5"
            style={{ background: "linear-gradient(135deg, #EAF2FF 0%, #F4F8FF 55%, #FFFFFF 100%)" }}>
            <div className="text-center max-w-md mx-auto">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-[0.15em]">
                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
              </div>
              <h2 className="text-4xl font-bold text-gray-900 tracking-tight mt-2">{authUser.name || authUser.username}</h2>
              {loadingStatus ? (
                <p className="text-sm text-gray-400 mt-3">Loading today's status…</p>
              ) : loadError ? (
                <p className="text-sm text-red-600 mt-3">{loadError}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-3">
                  {!lastPunch ? "Not punched in yet today"
                    : state === "in" ? `Punched in at ${fmtTime(lastPunch.at)}`
                    : `Punched out at ${fmtTime(lastPunch.at)}`}
                </p>
              )}
              <button
                disabled={loadingStatus}
                onClick={() => startPunch(state === "in" ? "out" : "in")}
                className={"mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-12 py-4 rounded-xl font-semibold text-base text-white shadow-lg transition disabled:opacity-50 "
                  + (state === "in" ? "bg-gray-800 hover:bg-gray-900" : "bg-green-600 hover:bg-green-700")}>
                {state === "in" ? <IconStop size={16} /> : <IconPlay size={16} />}
                {state === "in" ? "Punch Out" : "Punch In"}
              </button>
            </div>
          </div>

          {/* Nothing to show yet on a day with no punches at all — the timeline, stat cards, and
              calendar only appear once today's first punch-in has actually happened. */}
          {dayPunches.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="order-2 lg:order-1 lg:col-span-2 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 transition duration-200 hover:shadow-xl hover:shadow-gray-400/30 hover:-translate-y-0.5">
                <button onClick={() => setTodayOpen((o) => !o)}
                  className="w-full flex items-center justify-between mb-0 lg:mb-4 flex-wrap gap-2 lg:cursor-default lg:pointer-events-none">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-800 uppercase tracking-wide">
                    <IconList size={14} /> Today's Attendance
                    <span className={"lg:hidden text-gray-400 text-xs transition-transform " + (todayOpen ? "rotate-180" : "")}>▾</span>
                  </div>
                  {/* Display only — the calendar below already lets a day be opened; this isn't a
                      second date picker, just today's date shown the way the reference shows it. */}
                  <div className="text-xs font-medium text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5">
                    {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </div>
                </button>
                <div className={(todayOpen ? "block" : "hidden") + " lg:block mt-4 lg:mt-0"}>
                  {dayPunches.map((p, i) => (
                    <div key={p.id} className="relative flex items-start gap-3 pb-5 last:pb-0">
                      {i < dayPunches.length - 1 && <div className="absolute left-4 top-9 bottom-0 w-px bg-gray-200" />}
                      <div className={"w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold z-10 "
                        + (p.type === "in" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500")}>
                        {p.type === "in" ? "↘" : "↗"}
                      </div>
                      <div className="flex-1 flex items-center justify-between min-w-0 pt-1">
                        <div className="min-w-0">
                          <div className={"text-sm font-semibold " + (p.auto_closed ? "text-amber-600" : "text-gray-800")}>
                            {punchLabel(p)}
                          </div>
                          <div className="text-xs text-gray-400 truncate flex items-center gap-1"><IconPin size={11} /> {punchLocationLabel(p)}</div>
                        </div>
                        <div className="text-sm text-gray-500 flex-shrink-0 pl-3">{fmtTime(p.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="order-1 lg:order-2 space-y-4">
                <MyAttendanceCalendar authUser={authUser} />
              </div>
            </div>
          )}
        </>
      )}

      {isAdmin && adminView && (
        <div className={adminView === "log" ? "max-w-3xl" : "max-w-2xl"}>
          <button onClick={() => setAdminView(null)}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 bg-white ring-1 ring-gray-200 shadow-sm rounded-xl px-3 py-1.5 mb-3 hover:bg-gray-50 hover:text-gray-700 transition">
            ← Back to Attendance
          </button>
          {adminView === "quiz" && <QuizSetupPanel settings={settings} setSettings={setSettings} />}
          {adminView === "log" && <AttendanceAdminLog users={users} />}
          {adminView === "location" && <AttendanceLocationsPanel settings={settings} setSettings={setSettings} />}
        </div>
      )}

      {flow && createPortal(
        // The photo step fills the phone's whole screen (no dialog chrome, no backdrop gap) — a
        // camera view boxed into a small modal card reads like a broken widget on a phone, not a
        // camera. Desktop keeps the normal centered dialog either way; only the sizing here is
        // responsive, so this stays the one <video> element the capture/face-check logic binds to
        // — a second one for a "mobile version" would silently steal videoRef's stream from it.
        <div className={"fixed inset-0 z-[9000] bg-black/70 backdrop-blur-sm flex items-center justify-center "
          + (flow.step === "photo" ? "p-0 sm:p-4" : "p-4")}>
          <div className={"bg-white shadow-2xl w-full overflow-y-auto relative "
            + (flow.step === "photo"
              ? "h-full sm:h-auto flex flex-col sm:block sm:max-h-[90vh] sm:max-w-md rounded-none sm:rounded-2xl p-5 sm:p-6"
              : "max-h-[90vh] rounded-2xl p-6 " + ((flow.step === "video" || flow.step === "quiz") ? "max-w-2xl" : "max-w-md"))}>
            {flow.step !== "saving" && (
              <button onClick={() => setFlow(null)} className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 text-2xl leading-none" title="Cancel (Esc)">×</button>
            )}

            <h3 className="text-lg font-bold text-gray-900 pr-6">
              {flow.type === "in" ? "Punch In" : "Punch Out"}
            </h3>

            {flow.step === "photo" && (
              <div className="mt-4 flex-1 flex flex-col min-h-0 sm:flex-none sm:block">
                <p className="text-sm text-gray-500 mb-3">Take a photo of yourself to {flow.type === "in" ? "punch in" : "punch out"}.</p>
                {flow.photoDataUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-black flex-1 sm:flex-none sm:aspect-square sm:max-w-[260px] sm:mx-auto">
                    <img src={flow.photoDataUrl} alt="" className="w-full h-full object-cover opacity-70" />
                    <div className="absolute inset-0 flex items-center justify-center text-white text-sm font-medium">Checking photo…</div>
                  </div>
                ) : cameraError ? (
                  <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-10 flex-1 sm:flex-none cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 transition">
                    <IconCamera size={28} />
                    <span className="text-sm font-semibold text-gray-600">Open Camera</span>
                    {cameraError === "denied" && (
                      <span className="text-xs text-amber-600 px-6 text-center">Camera access was blocked — allow it for this site, or pick a photo instead.</span>
                    )}
                    <input type="file" accept="image/*" capture="user" className="hidden" onChange={handleFile} />
                  </label>
                ) : (
                  <div className="relative rounded-xl overflow-hidden bg-black flex-1 sm:flex-none sm:aspect-square sm:max-w-[260px] sm:mx-auto">
                    {/* Mirrored for a natural "looking in a mirror" preview — the frame captured onto
                        the canvas below is drawn from the raw (unmirrored) video, so the saved photo
                        reads correctly to anyone who looks at it later. */}
                    <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setVideoReady(true)}
                      className="w-full h-full object-cover -scale-x-100" />
                    {/* Green only once a face is actually found inside it (watchFaceInVideo) — tells
                        you when you're framed, not just where to aim. The real gate is still the
                        one-shot check on the captured frame; this is live guidance, not that gate. */}
                    {videoReady && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className={"w-[70%] h-[70%] sm:w-[60%] sm:h-[80%] rounded-[50%] border-[3px] transition-colors duration-200 "
                          + (faceInOval ? "border-green-400" : "border-white/50")}
                          style={{ boxShadow: "0 0 0 1000px rgba(0,0,0,0.35)" }} />
                      </div>
                    )}
                  </div>
                )}
                {!flow.photoDataUrl && !cameraError && (
                  <button onClick={capturePhoto} disabled={!videoReady || !faceInOval}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex-shrink-0">
                    <IconCamera size={16} /> Take Photo
                  </button>
                )}
                {videoReady && !faceInOval && (
                  <p className="text-xs text-gray-400 mt-2 text-center">Line your face up inside the oval</p>
                )}
                {flow.failMsg && <p className="text-sm text-red-600 mt-3 text-center">{flow.failMsg}</p>}
              </div>
            )}

            {flow.step === "video" && (
              <div className="mt-4">
                {flow.videoRetryNote && (
                  <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                    Two wrong answers — watch it again before the next try.
                  </p>
                )}
                <p className="text-sm text-gray-500 mb-3">Watch this, then answer a couple of questions.</p>
                <AttendanceVideoPlayer videoUrl={myTraining.videoUrl}
                  onEnded={() => setFlow((f) => f && ({ ...f, videoDone: true }))}
                  onError={() => setFlow((f) => f && ({ ...f, videoBroken: true }))} />
                <button
                  disabled={hasVideo && !flow.videoDone && !flow.videoBroken}
                  onClick={() => setFlow((f) => f && ({ ...f, step: f.questions.length ? "quiz" : "photo", videoRetryNote: false }))}
                  className="mt-4 w-full py-2.5 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
                  Continue
                </button>
              </div>
            )}

            {flow.step === "quiz" && (
              <div className="mt-4">
                <p className="text-sm text-gray-500 mb-3">Quick check before you're punched in.</p>
                <div className="space-y-4">
                  {flow.questions.map((q, qi) => {
                    const type = q.type || "single";
                    const wrong = flow.quizWrong?.includes(q.id);
                    const setAnswer = (val) => setFlow((f) => f && ({ ...f, answers: { ...f.answers, [q.id]: val } }));
                    return (
                      <div key={q.id}>
                        <p className={"text-sm font-medium mb-1.5 " + (wrong ? "text-red-600" : "text-gray-800")}>
                          {qi + 1}. {q.text}
                        </p>
                        {type === "single" && (
                          <div className="space-y-1 ml-1">
                            {q.options.map((opt, oi) => (
                              <label key={oi} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                <input type="radio" name={`q_${q.id}`} checked={flow.answers[q.id] === oi} onChange={() => setAnswer(oi)} />
                                {opt}
                              </label>
                            ))}
                          </div>
                        )}
                        {type === "multi" && (
                          <div className="space-y-1 ml-1">
                            <p className="text-xs text-gray-400 mb-1">Select all that apply.</p>
                            {q.options.map((opt, oi) => {
                              const cur = Array.isArray(flow.answers[q.id]) ? flow.answers[q.id] : [];
                              const checked = cur.includes(oi);
                              return (
                                <label key={oi} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                  <input type="checkbox" checked={checked}
                                    onChange={() => setAnswer(checked ? cur.filter((i) => i !== oi) : [...cur, oi])} />
                                  {opt}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {type === "fill_blank" && (
                          <input value={flow.answers[q.id] || ""} onChange={(e) => setAnswer(e.target.value)}
                            placeholder="Type your answer" className="w-full border rounded-lg px-3 py-1.5 text-sm" />
                        )}
                        {type === "short_answer" && (
                          <textarea value={flow.answers[q.id] || ""} onChange={(e) => setAnswer(e.target.value)}
                            placeholder="Write your answer" rows={2} className="w-full border rounded-lg px-3 py-1.5 text-sm" />
                        )}
                      </div>
                    );
                  })}
                </div>
                {flow.quizWrong?.length > 0 && (
                  <p className="text-sm text-red-600 mt-3">
                    Some answers aren't right — check the highlighted ones and try again.
                    {flow.quizAttempts >= 1 && " One more miss and you'll need to rewatch the video."}
                  </p>
                )}
                <button onClick={submitQuiz} className="mt-4 w-full py-2.5 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition">
                  Submit answers
                </button>
              </div>
            )}

            {flow.step === "saving" && (
              <div className="mt-6 text-center text-gray-500 py-6">
                <svg className="animate-spin mx-auto mb-2 text-indigo-500" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                Saving your punch…
              </div>
            )}

            {flow.step === "error" && (
              <div className="mt-4 text-center">
                <p className="text-sm text-red-600 mb-4">{flow.saveError}</p>
                <div className="flex gap-2 justify-center">
                  <button onClick={() => setFlow(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700">Start over</button>
                  <button onClick={() => setFlow((f) => f && ({ ...f, step: "saving", saveError: "" }))} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white">Retry</button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Everyone: this month's stat cards + calendar ──────────────────────────────
// 'Absent' here is deliberately narrow — a PAST day with zero punches, nothing more. There's still
// no "Half Day" (no shift-length anywhere to define it against) and no weekly-off/holiday calendar,
// so a Sunday or a company holiday with no punch reads the same as a genuine no-show. See dayStatus
// in lib/ims/attendance.js. Owns its month's data once and renders both the stat cards row and the
// calendar grid from it, rather than fetching the same month twice.
function MyAttendanceCalendar({ authUser }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openDay, setOpenDay] = useState(null);

  useEffect(() => {
    if (!authUser?.id) return;
    let active = true;
    setLoading(true);
    fetchMonthPunches(authUser.id, year, month)
      .then((data) => { if (active) { setRows(data); setError(""); } })
      .catch((e) => { if (active) setError(e.message || "Couldn't load attendance"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authUser?.id, year, month]);

  function shiftMonth(delta) {
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y); setOpenDay(null);
  }

  const byDate = groupPunchesByDate(rows);
  const today = todayStr();
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  let presentDays = 0, incompleteDays = 0, totalHours = 0;
  Object.entries(byDate).forEach(([d, dayRows]) => {
    presentDays++;
    if (dayStatus(dayRows, d, today) === "open") incompleteDays++;
    totalHours += dayHours(dayRows);
  });

  const dotProps = (status) => {
    if (status === "closed") return { className: "bg-green-500" };
    if (status === "open") return { className: "bg-amber-500" };
    if (status === "in-progress") return { className: "bg-blue-500" };
    if (status === "absent") return { className: "bg-red-500" };
    return null;
  };

  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard variant="green" icon={<IconUsers size={15} />} label="Present" value={loading ? "…" : presentDays} sub="Days this month" />
        <StatCard variant="amber" icon={<IconClockAlert size={15} />} label="Incomplete" value={loading ? "…" : incompleteDays} sub="Never punched out" />
        <StatCard variant="blue" icon={<IconHourglass size={15} />} label="Hours" value={loading ? "…" : totalHours.toFixed(1)} sub="This month" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 transition duration-200 hover:shadow-xl hover:shadow-gray-400/30 hover:-translate-y-0.5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => shiftMonth(-1)} className="text-gray-400 hover:text-gray-700 px-2 text-lg leading-none">‹</button>
          <div className="text-sm font-bold text-gray-800">{monthLabel}</div>
          <button onClick={() => shiftMonth(1)} className="text-gray-400 hover:text-gray-700 px-2 text-lg leading-none">›</button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-600 text-center py-6">{error}</p>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-gray-400 uppercase mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={"blank" + i} />;
                const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                const dayRows = byDate[dateStr];
                const status = dayStatus(dayRows, dateStr, today);
                const dot = dotProps(status);
                const isToday = dateStr === today;
                return (
                  <button key={d} disabled={!dayRows} onClick={() => setOpenDay(dateStr)}
                    className={"aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition "
                      + (isToday ? "bg-blue-600 text-white font-bold shadow-sm hover:bg-blue-700 "
                        : dayRows ? "hover:bg-gray-50 cursor-pointer text-gray-700 " : "cursor-default text-gray-400 ")}>
                    <span>{d}</span>
                    {dot && <span className={"w-1.5 h-1.5 rounded-full " + dot.className} />}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 pt-3 border-t text-[11px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />Closed</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Never punched out</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Still in</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Absent</span>
            </div>
          </>
        )}

        {openDay && byDate[openDay] && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {new Date(openDay + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <div className="space-y-1">
              {byDate[openDay].map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm py-1">
                  <div>
                    <div className={p.type === "in" ? "text-green-700 font-medium" : p.auto_closed ? "text-amber-600 font-medium" : "text-gray-600 font-medium"}>
                      {punchLabel(p)}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-1"><IconPin size={11} /> {punchLocationLabel(p)}</div>
                  </div>
                  <span className="text-gray-400">{fmtTime(p.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
