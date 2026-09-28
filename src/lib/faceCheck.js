// ─── On-device human-presence check for attendance photos ─────────────────────
// Confirms a face is actually in frame — both LIVE, for the oval guide's green/not-green state
// while framing the shot, and as the real gate on the photo that's actually captured. Catches the
// obvious misses (camera blocked by a thumb, photo of the ceiling, wrong end of the phone) without
// sending the photo anywhere. It is NOT a liveness/anti-spoof check: a printed photo or a photo of
// a screen held up to the camera can still pass. Runs fully client-side via MediaPipe's Face
// Detector — the WASM runtime and the model file are fetched from Google's/jsdelivr's CDN at
// runtime rather than bundled, the same tolerance for a runtime CDN fetch the setup-book PDF
// export already relies on for its webfonts. CPU delegate, not GPU: GPU can silently fail to
// initialise on some Android WebViews, which would wedge every punch.
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

// Pinned to the installed npm version so the CDN assets and the API this file calls never drift
// apart from each other.
const MP_VERSION = "1.0.1";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detectorPromise = null;
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        // VIDEO mode throughout: detectForVideo also takes a plain still image (with a
        // timestamp), so this ONE detector instance serves both the live oval indicator (polling
        // the <video> element) and the one-shot check on the captured photo. The cost is that
        // detectForVideo demands strictly increasing timestamps across every call made on it — so
        // every caller, live or one-shot, goes through nextTimestamp() below rather than rolling
        // its own.
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      });
    })();
    // A failed load (offline, CDN blocked) must not wedge every later punch attempt with the
    // same rejected promise — let the next call try again from scratch.
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

let lastTs = 0;
function nextTimestamp() {
  // performance.now() is already monotonic, but two calls landing in the same millisecond (or a
  // suspended tab's clock doing something odd) tie — detectForVideo THROWS on a non-increasing
  // timestamp, so this forces it up by at least 1 regardless of what the clock says.
  const ts = Math.max(Math.round(performance.now()), lastTs + 1);
  lastTs = ts;
  return ts;
}

/**
 * Polls a live <video> element a few times a second and reports whether a face is currently
 * visible, until stopped. This drives the oval guide's live state only — it is NOT the punch
 * gate; that's checkFaceInPhoto below, run once on the frame actually captured.
 * @returns {() => void} stop function — always call it (camera turning off, step changing, unmount)
 */
export function watchFaceInVideo(videoEl, onChange) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    try {
      if (videoEl.readyState >= 2 && videoEl.videoWidth) {
        const detector = await getDetector();
        if (stopped) return;
        const result = detector.detectForVideo(videoEl, nextTimestamp());
        onChange(!!result?.detections?.length);
      }
    } catch {
      // A transient decode/model hiccup shouldn't flip the oval for one frame — leave the last
      // known state alone and just try again next tick.
    }
    if (!stopped) timer = setTimeout(tick, 220); // ~4-5x/sec: responsive enough, cheap on CPU delegate
  };
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/**
 * @param {string} dataUrl a data: URL, as FileReader.readAsDataURL gives you
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function checkFaceInPhoto(dataUrl) {
  try {
    const img = new Image();
    const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    img.src = dataUrl;
    await loaded;
    const detector = await getDetector();
    const result = detector.detectForVideo(img, nextTimestamp());
    if (!result?.detections?.length) {
      return { ok: false, reason: "No face found in the photo — hold the phone at arm's length, facing you, in good light." };
    }
    return { ok: true };
  } catch (err) {
    // The model failing to load (offline, a corporate firewall blocking the CDN) must not lock
    // someone out of punching in over an infra problem that has nothing to do with the photo —
    // same "one bad block must not lose the whole thing" principle as the PDF export.
    console.warn("[attendance] face check unavailable, letting the punch through:", err);
    return { ok: true, reason: "unavailable" };
  }
}
