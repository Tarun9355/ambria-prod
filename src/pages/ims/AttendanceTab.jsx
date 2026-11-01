import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uploadToStorage, compressPunchPhoto, STORAGE_FOLDERS } from "../../lib/storage";
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
import LabourPunchPanel from "./LabourPunchPanel.jsx";
import LabourAdminLog from "./LabourAdminLog.jsx";
import { labourPunchDepts } from "../../lib/ims/labourAttendance";
import {
  IconHourglass, IconPlay, IconStop, IconClipboard, IconPin,
  IconCamera, IconList, IconClipboardCheck, IconX, IconArrowRight, IconChevron, IconClock, IconCheck,
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
// Hours as "7h 05m" ("45m" under an hour).
const fmtDur = (h) => {
  const m = Math.max(0, Math.round((Number(h) || 0) * 60));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export default function AttendanceTab({ authUser, settings, setSettings, users, view, setView, myLabourAccess = [], reloadLabourAccess }) {
  const isAdmin = (authUser?.role || "").toLowerCase() === "admin" || authUser?.id === "u_admin";
  // null when this user has no single matching build department — same as no video configured
  // (see attendanceQuizDept's own comment for exactly who that covers).
  const myQuizDept = attendanceQuizDept(authUser);
  const myTraining = (myQuizDept && settings?.attendanceTrainingByDept?.[myQuizDept]) || { videoUrl: "", questions: [] };
  const [dayPunches, setDayPunches] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [flow, setFlow] = useState(null);
  // null | "labour" | "quiz" | "log" | "labourlog" | "location" — which sub-view has taken over the
  // page. Owned by IMS.jsx, because the sub-views are picked from the sidebar (Attendance's
  // sub-items) rather than a link row on this page. "labour" needs labour-punch access; the rest
  // are Admin-only — anything this user may not open falls back to the punch screen.
  const canLabourPunch = labourPunchDepts(authUser, myLabourAccess).length > 0;
  const adminView = !view ? null : view === "labour" ? (canLabourPunch ? view : null) : (isAdmin ? view : null);
  const setAdminView = (v) => setView?.(v);
  // Mobile only — collapsed by default so the phone view opens on the stat cards + calendar, not
  // a long scrolling list of today's punches; desktop always shows it expanded regardless (see the
  // "hidden lg:block" pairing below, the standard Tailwind way to make a collapse mobile-only).
  const [todayOpen, setTodayOpen] = useState(false);
  const savingRef = useRef(false);
  // The clock the page reads (greeting, "worked today", the open session's length) - a minute is its finest step.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

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

        const compressed = await compressPunchPhoto(flow.photoFile);
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

  if (!authUser) return <div className="text-center text-gray-500 py-20">Sign in to use Attendance.</div>;

  const state = currentState(dayPunches);
  const lastPunch = dayPunches[dayPunches.length - 1];
  const hasVideo = !!extractYouTubeId(myTraining.videoUrl);
  // Worked today, ticking while punched in: the closed sessions plus the open one so far.
  const openSince = state === "in" && lastPunch ? new Date(lastPunch.at).getTime() : null;
  const workedToday = dayHours(dayPunches) + (openSince ? Math.max(0, now - openSince) / 3600000 : 0);
  const firstIn = dayPunches.find((p) => p.type === "in");
  const lastOut = state === "out" ? [...dayPunches].reverse().find((p) => p.type === "out") : null;
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = String(authUser.name || authUser.username || "").trim().split(/\s+/)[0];
  // What the button will ask for, said before it is pressed: punch-in runs the briefing first.
  const inSteps = [hasVideo && "watch the briefing", myTraining.questions?.length > 0 && "answer a short quiz", "take a selfie"].filter(Boolean);
  const nextHint = state === "in" ? "A selfie punches you out."
    : `You'll ${inSteps.length > 1 ? inSteps.slice(0, -1).join(", ") + " and " + inSteps[inSteps.length - 1] : inSteps[0]}.`;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* The sub-views (Labour Punch, Quiz Setup, Staff Log, Labour Log, Manage Locations) are picked
          from the sidebar — Attendance's sub-items (IMS.jsx). Each is a full takeover of this page;
          the Back button returns to the punch screen. */}
      {!adminView && (
        <>
          {/* ── TODAY ── who, where they stand and the one action; then today's three numbers. */}
          <section aria-label="Today" className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm overflow-hidden">
            <div className="p-5 sm:p-7 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm text-gray-500">{new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                <h2 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 truncate">{greeting}{firstName ? `, ${firstName}` : ""}</h2>
                <div className="mt-3" aria-live="polite">
                  {loadingStatus ? (
                    <span className="inline-flex items-center gap-2 text-sm text-gray-500">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" aria-hidden="true" />
                      Checking today's status…
                    </span>
                  ) : loadError ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-red-50 ring-1 ring-red-200 px-3 py-1 text-sm font-medium text-red-700">{loadError}</span>
                  ) : state === "in" ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-green-50 ring-1 ring-green-200 px-3 py-1 text-sm font-medium text-green-800">
                      <span className="relative flex w-2 h-2" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60 motion-safe:animate-ping" />
                        <span className="relative inline-flex w-2 h-2 rounded-full bg-green-600" />
                      </span>
                      On duty since {fmtTime(lastPunch.at)}
                    </span>
                  ) : lastPunch ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 ring-1 ring-gray-200 px-3 py-1 text-sm font-medium text-gray-700">
                      <span className="w-2 h-2 rounded-full bg-gray-400" aria-hidden="true" />
                      {lastPunch.auto_closed ? "Auto punched out" : "Punched out"} at {fmtTime(lastPunch.at)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 ring-1 ring-amber-200 px-3 py-1 text-sm font-medium text-amber-800">
                      <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
                      Not punched in yet
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-stretch md:items-end gap-2 md:shrink-0">
                <button
                  disabled={loadingStatus}
                  onClick={() => startPunch(state === "in" ? "out" : "in")}
                  className={"inline-flex items-center justify-center gap-2.5 min-h-12 px-8 rounded-xl text-base font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed "
                    + (state === "in" ? "bg-gray-900 hover:bg-gray-800 focus-visible:ring-gray-900" : "bg-green-600 hover:bg-green-700 focus-visible:ring-green-600")}>
                  {state === "in" ? <IconStop size={16} /> : <IconPlay size={16} />}
                  {state === "in" ? "Punch Out" : "Punch In"}
                </button>
                {!loadingStatus && !loadError && <p className="text-xs text-gray-500 text-center md:text-right">{nextHint}</p>}
              </div>
            </div>
            <dl className="grid grid-cols-3 border-t border-gray-100 bg-gray-50/70 divide-x divide-gray-100">
              {[
                ["First in", firstIn ? fmtTime(firstIn.at) : "—"],
                [state === "in" ? "Status" : "Last out", state === "in" ? "Working" : lastOut ? fmtTime(lastOut.at) : "—"],
                ["Worked today", dayPunches.length ? fmtDur(workedToday) : "—"],
              ].map(([k, v]) => (
                <div key={k} className="px-4 sm:px-7 py-3.5 min-w-0">
                  <dt className="text-xs text-gray-500 truncate">{k}</dt>
                  <dd className="mt-0.5 text-base sm:text-lg font-semibold text-gray-900 tabular-nums truncate">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            {/* ── TODAY'S PUNCHES ── a timeline, with the time spent between each in and out. */}
            <section aria-label="Today's punches" className="order-2 lg:order-1 lg:col-span-2 rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
              <button onClick={() => setTodayOpen((o) => !o)} aria-expanded={todayOpen}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left lg:cursor-default lg:pointer-events-none">
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <IconList size={15} /> Today's punches
                  {dayPunches.length > 0 && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">{dayPunches.length}</span>}
                </span>
                <span className={"lg:hidden text-gray-400 transition-transform duration-200 " + (todayOpen ? "rotate-180" : "")} aria-hidden="true"><IconChevron size={16} /></span>
              </button>
              <div className={(todayOpen ? "block" : "hidden") + " lg:block border-t border-gray-100 px-5 py-4"}>
                {!dayPunches.length ? (
                  <div className="py-8 text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><IconClock size={18} /></div>
                    <p className="mt-3 text-sm font-medium text-gray-700">No punches yet today</p>
                    <p className="mt-1 text-xs text-gray-500">Your punch-in and punch-out times show up here.</p>
                  </div>
                ) : (
                  <ol>
                    {dayPunches.map((p, i) => {
                      const next = dayPunches[i + 1];
                      const isIn = p.type === "in";
                      const endMs = next?.type === "out" ? new Date(next.at).getTime() : (isIn && !next ? now : null);
                      const span = isIn && endMs != null ? endMs - new Date(p.at).getTime() : null;
                      return (
                        <li key={p.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                          {i < dayPunches.length - 1 && <span aria-hidden="true" className="absolute left-[15px] top-9 bottom-1 w-px bg-gray-200" />}
                          <span aria-hidden="true" className={"relative z-10 w-8 h-8 shrink-0 rounded-full ring-4 ring-white flex items-center justify-center "
                            + (isIn ? "bg-green-50 text-green-700" : p.auto_closed ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600")}>
                            {isIn ? <IconPlay size={13} /> : <IconStop size={13} />}
                          </span>
                          <div className="min-w-0 flex-1 pt-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className={"text-sm font-semibold " + (p.auto_closed ? "text-amber-700" : "text-gray-900")}>{punchLabel(p)}</span>
                              <time className="shrink-0 text-sm font-medium text-gray-700 tabular-nums" dateTime={p.at}>{fmtTime(p.at)}</time>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 min-w-0"><IconPin size={11} /><span className="truncate">{punchLocationLabel(p)}</span></div>
                            {span != null && span > 0 && (
                              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-gray-50 ring-1 ring-gray-100 px-2 py-0.5 text-xs text-gray-600 tabular-nums">
                                <IconHourglass size={11} /> {fmtDur(span / 3600000)}{next ? "" : " so far"}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </section>

            <div className="order-1 lg:order-2">
              <MyAttendanceCalendar authUser={authUser} />
            </div>
          </div>
        </>
      )}

      {adminView && (isAdmin || (adminView === "labour" && canLabourPunch)) && (
        <div className={adminView === "labour" ? (isAdmin ? "max-w-6xl" : "max-w-3xl") : adminView === "log" ? "max-w-3xl" : adminView === "quiz" || adminView === "labourlog" ? "max-w-4xl" : "max-w-2xl"}>
          <button onClick={() => setAdminView(null)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 bg-white ring-1 ring-gray-200 shadow-sm rounded-xl pl-2 pr-3 py-1.5 mb-3 hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">
            <span className="rotate-90" aria-hidden="true"><IconChevron size={15} /></span> Back to Attendance
          </button>
          {adminView === "quiz" && <QuizSetupPanel settings={settings} />}
          {adminView === "log" && <AttendanceAdminLog users={users} />}
          {adminView === "labourlog" && <LabourAdminLog />}
          {adminView === "location" && <AttendanceLocationsPanel settings={settings} />}
          {adminView === "labour" && (
            <LabourPunchPanel authUser={authUser} users={users} settings={settings} myAccess={myLabourAccess} onAccessChanged={reloadLabourAccess} />
          )}
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
          <div role="dialog" aria-modal="true" aria-label={flow.type === "in" ? "Punch in" : "Punch out"}
            className={"bg-white shadow-2xl w-full overflow-y-auto relative "
            + (flow.step === "photo"
              ? "h-full sm:h-auto flex flex-col sm:block sm:max-h-[90vh] sm:max-w-md rounded-none sm:rounded-2xl p-5 sm:p-6"
              : "max-h-[90vh] rounded-2xl p-6 " + ((flow.step === "video" || flow.step === "quiz") ? "max-w-2xl" : "max-w-md"))}>
            {flow.step !== "saving" && (
              <button onClick={() => setFlow(null)}
                aria-label="Cancel (Esc)" className="absolute top-4 right-4 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 z-10" title="Cancel (Esc)">
                <IconX size={16} />
              </button>
            )}

            {(flow.step === "photo" || flow.step === "video" || flow.step === "quiz") ? (
              <div className="flex items-start gap-3 pr-10">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  {flow.step === "photo" && <IconCamera size={22} />}
                  {flow.step === "video" && <IconPlay size={22} />}
                  {flow.step === "quiz" && <IconClipboardCheck size={22} />}
                </div>
                <div className="min-w-0 pt-1">
                  <h3 className="text-xl font-bold text-gray-900">{flow.type === "in" ? "Punch In" : "Punch Out"}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {flow.step === "photo" && `Take a photo of yourself to ${flow.type === "in" ? "punch in" : "punch out"}.`}
                    {flow.step === "video" && (flow.questions.length ? "Watch this, then answer a couple of questions." : "Watch this before you're punched in.")}
                    {flow.step === "quiz" && "Quick check before you're punched in."}
                  </p>
                </div>
              </div>
            ) : (
              <h3 className="text-lg font-bold text-gray-900 pr-6">
                {flow.type === "in" ? "Punch In" : "Punch Out"}
              </h3>
            )}

            {/* Where you are in a punch-in: briefing, quiz (when one is set), selfie. Punch-out is one step. */}
            {flow.needsTraining && (() => {
              const steps = [["video", "Briefing"], ...(flow.questions.length ? [["quiz", "Quiz"]] : []), ["photo", "Selfie"]];
              const at = flow.step === "video" ? 0 : flow.step === "quiz" ? 1 : steps.length - 1;
              const done = (i) => i < at || flow.step === "saving";
              return (
                <ol className="mt-5 flex items-center gap-2" aria-label="Punch-in steps">
                  {steps.map(([k, label], i) => (
                    <li key={k} className="flex items-center gap-2 min-w-0 flex-1 last:flex-none" aria-current={i === at ? "step" : undefined}>
                      <span className={"shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors "
                        + (done(i) ? "bg-green-600 text-white" : i === at ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500")}>
                        {done(i) ? <IconCheck size={12} /> : i + 1}
                      </span>
                      <span className={"text-xs font-medium truncate " + (i === at ? "text-gray-900" : "text-gray-500")}>{label}</span>
                      {i < steps.length - 1 && <span aria-hidden="true" className={"h-px flex-1 min-w-3 " + (done(i) ? "bg-green-300" : "bg-gray-200")} />}
                    </li>
                  ))}
                </ol>
              );
            })()}

            {flow.step === "photo" && (
              <div className="mt-4 flex-1 flex flex-col min-h-0 sm:flex-none sm:block">
                {flow.photoDataUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-black flex-1 sm:flex-none sm:aspect-square sm:max-w-[260px] sm:mx-auto">
                    <img src={flow.photoDataUrl} alt="" className="w-full h-full object-cover opacity-70" />
                    <div className="absolute inset-0 flex items-center justify-center text-white text-sm font-medium">Checking photo…</div>
                  </div>
                ) : cameraError ? (
                  <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-10 flex-1 sm:flex-none cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition">
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
                    className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex-shrink-0">
                    <IconCamera size={16} /> Take Photo
                  </button>
                )}
                {videoReady && !faceInOval && (
                  <p className="text-xs text-gray-500 mt-2 text-center">Line your face up inside the oval</p>
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
                <AttendanceVideoPlayer videoUrl={myTraining.videoUrl}
                  onEnded={() => setFlow((f) => f && ({ ...f, videoDone: true }))}
                  onError={() => setFlow((f) => f && ({ ...f, videoBroken: true }))} />
                <button
                  disabled={hasVideo && !flow.videoDone && !flow.videoBroken}
                  onClick={() => setFlow((f) => f && ({ ...f, step: f.questions.length ? "quiz" : "photo", videoRetryNote: false }))}
                  className="mt-4 w-full py-2.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
                  Continue
                </button>
              </div>
            )}

            {flow.step === "quiz" && (
              <div className="mt-5">
                <div className="space-y-4">
                  {flow.questions.map((q, qi) => {
                    const type = q.type || "single";
                    const wrong = flow.quizWrong?.includes(q.id);
                    const setAnswer = (val) => setFlow((f) => f && ({ ...f, answers: { ...f.answers, [q.id]: val } }));
                    return (
                      <div key={q.id}
                        className={"rounded-2xl p-5 transition " + (wrong ? "bg-red-50 ring-1 ring-red-200" : "bg-gray-50")}>
                        <div className="flex items-start gap-3 mb-3">
                          <span className={"shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold "
                            + (wrong ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
                            {qi + 1}
                          </span>
                          <div className="min-w-0 pt-0.5">
                            <p className={"text-base font-bold " + (wrong ? "text-red-700" : "text-gray-900")}>
                              {q.textHi || q.text}
                            </p>
                            {/* The English/Hinglish source stays visible too — a bilingual pair, not a
                                replacement, since a mistranslation should never be the only text shown. */}
                            {q.textHi && <p className="text-sm text-gray-500 mt-0.5">{q.text}</p>}
                          </div>
                        </div>
                        {type === "multi" && <p className="text-sm text-gray-500 mb-2 ml-11">Select all that apply.</p>}
                        {(type === "single" || type === "multi") && (
                          <div className="space-y-2">
                            {q.options.map((opt, oi) => {
                              const optHi = (q.optionsHi || [])[oi];
                              const cur = type === "multi" ? (Array.isArray(flow.answers[q.id]) ? flow.answers[q.id] : []) : null;
                              const checked = type === "multi" ? cur.includes(oi) : flow.answers[q.id] === oi;
                              const pick = () => setAnswer(type === "multi" ? (checked ? cur.filter((i) => i !== oi) : [...cur, oi]) : oi);
                              return (
                                <label key={oi} onClick={pick}
                                  className={"flex items-center gap-3 rounded-xl px-4 py-3 bg-white ring-1 cursor-pointer transition "
                                    + (checked ? "ring-blue-400 shadow-sm" : "ring-gray-200 hover:ring-gray-300")}>
                                  <span className={"shrink-0 w-5 h-5 border-2 flex items-center justify-center transition "
                                    + (type === "multi" ? "rounded-md" : "rounded-full")
                                    + " " + (checked ? "border-blue-600 bg-blue-600" : "border-gray-300")}>
                                    {checked && <span className={"bg-white " + (type === "multi" ? "w-2.5 h-2.5 rounded-sm" : "w-2 h-2 rounded-full")} />}
                                  </span>
                                  <span className="text-sm text-gray-800">
                                    <span className="font-semibold">{optHi || opt}</span>
                                    {optHi && <span className="text-gray-500"> · {opt}</span>}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {type === "fill_blank" && (
                          <input value={flow.answers[q.id] || ""} onChange={(e) => setAnswer(e.target.value)}
                            placeholder="Type your answer" className="ml-11 w-[calc(100%-2.75rem)] border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        )}
                        {type === "short_answer" && (
                          <textarea value={flow.answers[q.id] || ""} onChange={(e) => setAnswer(e.target.value)}
                            placeholder="Write your answer" rows={2} className="ml-11 w-[calc(100%-2.75rem)] border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
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
                <button onClick={submitQuiz}
                  className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition">
                  Submit answers <IconArrowRight size={16} />
                </button>
              </div>
            )}

            {flow.step === "saving" && (
              <div className="mt-6 text-center text-gray-500 py-6">
                <svg className="animate-spin mx-auto mb-2 text-blue-500" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
                  <button onClick={() => setFlow((f) => f && ({ ...f, step: "saving", saveError: "" }))} className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white">Retry</button>
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
const DAY_STATUS = {
  closed: { dot: "bg-green-500", label: "Closed" },
  open: { dot: "bg-amber-500", label: "Never punched out" },
  "in-progress": { dot: "bg-blue-500", label: "Still in" },
  absent: { dot: "bg-red-400", label: "Absent" },
};

function MyAttendanceCalendar({ authUser }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openDay, setOpenDay] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!authUser?.id) return;
    let active = true;
    setLoading(true);
    fetchMonthPunches(authUser.id, year, month)
      .then((data) => { if (active) { setRows(data); setError(""); } })
      .catch((e) => { if (active) setError(e.message || "Couldn't load attendance"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authUser?.id, year, month, reload]);

  function shiftMonth(delta) {
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y); setOpenDay(null);
  }
  const isThisMonth = year === now.getFullYear() && month === now.getMonth() + 1;

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

  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const navBtn = "w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors";

  return (
    <section aria-label="This month" className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <h3 className="text-sm font-semibold text-gray-900" aria-live="polite">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          {!isThisMonth && (
            <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); setOpenDay(null); }}
              className="h-8 px-2.5 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">Today</button>
          )}
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className={navBtn}><span className="rotate-90"><IconChevron size={16} /></span></button>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className={navBtn}><span className="-rotate-90"><IconChevron size={16} /></span></button>
        </div>
      </div>

      <dl className="mx-5 mt-3 grid grid-cols-3 rounded-xl bg-gray-50 ring-1 ring-gray-100 divide-x divide-gray-100">
        {[["Present", presentDays, "days"], ["Incomplete", incompleteDays, "no punch-out"], ["Hours", totalHours.toFixed(1), "worked"]].map(([k, v, sub]) => (
          <div key={k} className="px-3 py-2.5 min-w-0">
            <dt className="text-[11px] text-gray-500 truncate">{k}</dt>
            <dd className="text-lg font-semibold text-gray-900 tabular-nums leading-tight">{loading ? <span className="inline-block w-6 h-4 rounded bg-gray-200 motion-safe:animate-pulse align-middle" /> : v}</dd>
            <dd className="text-[11px] text-gray-500 truncate">{sub}</dd>
          </div>
        ))}
      </dl>

      <div className="px-5 pb-5 pt-4">
        {error ? (
          <div className="py-6 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={() => setReload((n) => n + 1)} className="mt-2 text-xs font-semibold text-blue-700 hover:underline">Try again</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-gray-500 mb-1" aria-hidden="true">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className={"grid grid-cols-7 gap-1 transition-opacity " + (loading ? "opacity-50" : "")}>
              {cells.map((d, i) => {
                if (!d) return <div key={"blank" + i} />;
                const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                const dayRows = byDate[dateStr];
                const status = dayStatus(dayRows, dateStr, today);
                const st = DAY_STATUS[status];
                const isToday = dateStr === today;
                const isOpen = openDay === dateStr;
                return (
                  <button key={d} disabled={!dayRows} onClick={() => setOpenDay(isOpen ? null : dateStr)}
                    aria-label={`${d} ${monthLabel}${st ? ": " + st.label : ""}`} aria-pressed={dayRows ? isOpen : undefined}
                    className={"aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 "
                      + (isOpen ? "bg-blue-600 text-white font-semibold "
                        : isToday ? "ring-1 ring-blue-500 text-blue-700 font-semibold hover:bg-blue-50 "
                        : dayRows ? "text-gray-800 hover:bg-gray-100 cursor-pointer " : "text-gray-400 cursor-default ")}>
                    <span>{d}</span>
                    {st && <span aria-hidden="true" className={"w-1.5 h-1.5 rounded-full " + (isOpen ? "bg-white" : st.dot)} />}
                  </button>
                );
              })}
            </div>

            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-500">
              {Object.values(DAY_STATUS).map((s) => (
                <li key={s.label} className="flex items-center gap-1.5"><span aria-hidden="true" className={"w-2 h-2 rounded-full " + s.dot} />{s.label}</li>
              ))}
            </ul>
          </>
        )}

        {openDay && byDate[openDay] && (
          <div className="mt-4 rounded-xl bg-gray-50 ring-1 ring-gray-100 p-3.5">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="text-xs font-semibold text-gray-900">{new Date(openDay + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span>
              {dayHours(byDate[openDay]) > 0 && <span className="shrink-0 text-xs text-gray-500 tabular-nums">{fmtDur(dayHours(byDate[openDay]))}</span>}
            </div>
            <ul className="divide-y divide-gray-100">
              {byDate[openDay].map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <div className={"text-sm font-medium " + (p.type === "in" ? "text-green-700" : p.auto_closed ? "text-amber-700" : "text-gray-700")}>{punchLabel(p)}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1 min-w-0"><IconPin size={11} /><span className="truncate">{punchLocationLabel(p)}</span></div>
                  </div>
                  <time className="shrink-0 text-sm text-gray-600 tabular-nums" dateTime={p.at}>{fmtTime(p.at)}</time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
