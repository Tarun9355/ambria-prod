import { useEffect, useRef, useState } from "react";

// ─── Punch-in briefing video ────────────────────────────────────────────────────
// Embeds a YouTube link the admin pastes — not self-hosted. A genuinely custom, branding-free
// player needs the raw video stream URL, and YouTube exposes that nowhere: not the official API,
// not the embed. Getting it would mean reverse-engineering YouTube's internal player response
// (what yt-dlp and similar tools do), which is against YouTube's Terms of Service, breaks
// whenever YouTube changes their internals, and needs a server-side proxy to dodge CORS. Not
// doing that — this embeds YouTube properly instead, accepting its limits:
//   - YouTube can fall back to its OWN "can't play here — Watch on YouTube" card in place of the
//     video (an embedding restriction, a region rule, an unusual network). That card is drawn
//     INSIDE YouTube's iframe — cross-origin content this code cannot see or detect — so unlike a
//     real onError (private/deleted video, embedding disabled outright), THAT specific fallback
//     cannot be caught here. If staff keep seeing it, the fix is a different video/link, not code.
//   - What IS caught and fails safely open (see onError below): a real player error, and a link
//     that isn't a YouTube URL at all.
//
// controls:0 removes YouTube's own scrubber, and the poll loop below is the real seek-blocking —
// it watches the actual playback position and snaps any forward jump back to where it was,
// whatever caused it. Rewinding to re-watch a part is still allowed; only jumping ahead is
// corrected.
let ytApiPromise = null;
function loadYouTubeIframeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prevReady?.(); resolve(window.YT); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

// Accepts whatever a person actually pastes — a watch link, a share link, a Shorts link, or an
// already-embed one — and pulls out just the 11-char video id.
export function extractYouTubeId(url) {
  const m = String(url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|[?&]v=)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

const POLL_MS = 300;
const FORWARD_TOLERANCE_S = 1.5;

/** @param {{videoUrl:string, onEnded:()=>void, onError:()=>void}} props */
export default function AttendanceVideoPlayer({ videoUrl, onEnded, onError }) {
  const slotRef = useRef(null);
  const playerRef = useRef(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const lastGoodTimeRef = useRef(0);
  const [state, setState] = useState("loading"); // loading | ready | playing | paused | ended | error
  const [progress, setProgress] = useState(0); // 0-1, for the (non-interactive) bar
  const videoId = extractYouTubeId(videoUrl);

  useEffect(() => {
    if (!videoId) { setState("error"); onErrorRef.current?.(); return; }
    let cancelled = false;
    let poll = null;
    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !slotRef.current) return;
      playerRef.current = new YT.Player(slotRef.current, {
        videoId,
        playerVars: {
          controls: 0,   // no native scrubber — see the file header
          disablekb: 1,  // no arrow-key / space seek shortcuts either
          fs: 0, rel: 0, modestbranding: 1, playsinline: 1,
          origin: window.location.origin, // YouTube's own recommendation for the IFrame API
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setState("ready");
            poll = setInterval(() => {
              const p = playerRef.current;
              if (!p?.getCurrentTime) return;
              const cur = p.getCurrentTime();
              const dur = p.getDuration() || 0;
              if (cur > lastGoodTimeRef.current + FORWARD_TOLERANCE_S) {
                p.seekTo(lastGoodTimeRef.current, true); // skipped ahead — snap back
              } else {
                lastGoodTimeRef.current = cur;
              }
              setProgress(dur ? Math.min(1, lastGoodTimeRef.current / dur) : 0);
            }, POLL_MS);
          },
          onStateChange: (e) => {
            if (cancelled) return;
            if (e.data === YT.PlayerState.PLAYING) setState("playing");
            else if (e.data === YT.PlayerState.PAUSED) setState("paused");
            else if (e.data === YT.PlayerState.ENDED) { setState("ended"); setProgress(1); onEndedRef.current?.(); }
          },
          // A REAL, detectable failure (private/deleted video, embedding disabled, bad id) — see
          // the file header for the one kind of failure this can't detect.
          onError: () => { if (!cancelled) { setState("error"); onErrorRef.current?.(); } },
        },
      });
    });
    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      try { playerRef.current?.destroy(); } catch { /* iframe already gone */ }
    };
  }, [videoId]);

  function togglePlay() {
    const p = playerRef.current;
    if (!p) return;
    if (state === "playing") p.pauseVideo(); else p.playVideo();
  }

  if (!videoUrl) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm p-4 text-center">
        No training video is set yet — ask an admin to add one in Attendance.
      </div>
    );
  }
  if (!videoId) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm p-4 text-center">
        That doesn't look like a YouTube link — you can continue without it. An admin should check the link in Attendance.
      </div>
    );
  }
  return (
    <div>
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
        <div ref={slotRef} className="w-full h-full" />
        {/* Own play/pause chrome — the real YouTube controls are switched off above, so this is
            the only way to start or pause it. */}
        {(state === "ready" || state === "paused") && (
          <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/35 transition">
            <span className="w-16 h-16 rounded-full bg-white/95 flex items-center justify-center text-2xl text-gray-800 shadow-lg">▶</span>
          </button>
        )}
        {state === "playing" && (
          <button onClick={togglePlay} title="Pause"
            className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/55 hover:bg-black/70 text-white flex items-center justify-center text-sm">
            ❚❚
          </button>
        )}
      </div>
      {/* Progress only — deliberately no click/drag handler. Dragging this must not seek. */}
      <div className="h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
        <div className="h-full bg-indigo-600 transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
      </div>
      {state === "error" && (
        <p className="text-xs text-red-600 mt-2 text-center">
          The video couldn't load, so you can continue without it — an admin should check the link in Attendance.
        </p>
      )}
      {state !== "ended" && state !== "error" && (
        <p className="text-xs text-gray-400 mt-2 text-center">Watch the whole video to continue — skipping ahead isn't allowed.</p>
      )}
    </div>
  );
}
