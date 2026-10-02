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
// The library itself (~190KB) is imported lazily inside getDetector, so it lands in its own chunk
// fetched on the first punch instead of riding along in IMS's main bundle for every ops user.

// Pinned to the installed npm version so the CDN assets and the API this file calls never drift
// apart from each other.
const MP_VERSION = "1.0.1";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detectorPromise = null;
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
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
        // 0.6 at the model, and realFace() below then asks for 0.75 plus a face-shaped layout —
        // at 0.5 alone a finger or a palm over the lens was being reported as a face.
        minDetectionConfidence: 0.6,
      });
    })();
    // A failed load (offline, CDN blocked) must not wedge every later punch attempt with the
    // same rejected promise — let the next call try again from scratch.
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

// ── IS IT REALLY A FACE? ──
// BlazeFace will put a box on a finger, a palm or a patterned shirt at modest confidence. A real,
// upright face also has a LAYOUT, and the detector hands us its six landmarks (normalised 0–1:
// right eye, left eye, nose tip, mouth, right ear, left ear), so a detection only counts when:
//   • confidence ≥ MIN_SCORE
//   • the box is a plausible size (not a speck) and roughly face-proportioned (not a sliver)
//   • the two eyes are far enough apart for the box, and roughly level with each other
//   • the nose sits below the eyes, and the mouth below the nose
// Thresholds are loose enough for a selfie at arm's length or a guard photographing a labour a
// couple of metres away, in a phone held upright.
const MIN_SCORE = 0.75;
const MIN_FACE_FRACTION = 0.12;   // box width ≥ 12% of the frame's shorter side

function realFace(det, frameW, frameH) {
  const score = det?.categories?.[0]?.score ?? 0;
  if (score < MIN_SCORE) return false;
  const bb = det.boundingBox;
  if (!bb || !(bb.width > 0) || !(bb.height > 0)) return false;
  if (bb.width < Math.min(frameW, frameH) * MIN_FACE_FRACTION) return false;
  const ratio = bb.width / bb.height;
  if (ratio < 0.6 || ratio > 1.6) return false;
  const k = det.keypoints || [];
  if (k.length < 4) return false;
  const P = (i) => ({ x: k[i].x * frameW, y: k[i].y * frameH });
  const rEye = P(0), lEye = P(1), nose = P(2), mouth = P(3);
  const eyeDist = Math.hypot(lEye.x - rEye.x, lEye.y - rEye.y);
  if (eyeDist < bb.width * 0.22) return false;                 // eyes squashed together → not a face
  if (Math.abs(lEye.y - rEye.y) > eyeDist * 0.6) return false; // head tilted past ~30°, or not eyes
  const eyeY = (lEye.y + rEye.y) / 2;
  if (!(nose.y > eyeY)) return false;                           // nose below the eyes
  if (!(mouth.y > nose.y)) return false;                        // mouth below the nose
  return true;
}

const hasRealFace = (result, w, h) => (result?.detections || []).some((d) => realFace(d, w, h));

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
  // Debounced both ways: green only after GOOD_TO_GO consecutive real-face frames (~0.7s), back
  // to white after LOST consecutive misses — so one lucky frame of a thumb can't light the oval,
  // and one blink or motion-blurred frame doesn't flicker it off.
  const GOOD_TO_GO = 3, LOST = 2;
  let good = 0, bad = 0, state = false;
  const tick = async () => {
    if (stopped) return;
    try {
      if (videoEl.readyState >= 2 && videoEl.videoWidth) {
        const detector = await getDetector();
        if (stopped) return;
        const result = detector.detectForVideo(videoEl, nextTimestamp());
        if (hasRealFace(result, videoEl.videoWidth, videoEl.videoHeight)) { good++; bad = 0; } else { bad++; good = 0; }
        if (!state && good >= GOOD_TO_GO) { state = true; onChange(true); }
        else if (state && bad >= LOST) { state = false; onChange(false); }
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
    if (!hasRealFace(result, img.naturalWidth || img.width, img.naturalHeight || img.height)) {
      return { ok: false, reason: "No clear face in the photo — face the camera straight on, fully in frame, in good light." };
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
