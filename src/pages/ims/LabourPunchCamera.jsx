import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { checkFaceInPhoto, watchFaceInVideo } from "../../lib/faceCheck";
import { IconCamera, IconX } from "../../components/icons.jsx";

// ═══ LABOUR PUNCH CAMERA ═══
// The supervisor photographs ONE labour, the face check runs on that frame, and only a pass hands
// the photo back (onCaptured) — the panel then saves the punch. Same capture + face-check approach
// as the staff punch in AttendanceTab, but kept separate: that flow is woven into its video/quiz
// steps, and this one points the camera AWAY from the person holding the phone (rear camera by
// default, with a flip for phones where the labour is easier to frame from the front).
export default function LabourPunchCamera({ labour, type, onCaptured, onCancel, busy }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facing, setFacing] = useState("environment");
  const [cameraError, setCameraError] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const [faceInOval, setFaceInOval] = useState(false);
  const [preview, setPreview] = useState(null);   // dataUrl while checking
  const [failMsg, setFailMsg] = useState("");
  const live = !preview && !cameraError && !busy;

  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;
    setVideoReady(false);
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("unsupported"); return undefined; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err) => { if (!cancelled) setCameraError(err?.name === "NotAllowedError" ? "denied" : "unsupported"); });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [live, facing]);

  useEffect(() => {
    if (!live || !videoReady) { setFaceInOval(false); return undefined; }
    const stop = watchFaceInVideo(videoRef.current, setFaceInOval);
    return () => { stop(); setFaceInOval(false); };
  }, [live, videoReady]);

  // Esc closes (unless a save is in flight) and the page behind doesn't scroll.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onCancel(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [busy, onCancel]);

  async function runCheck(file, dataUrl) {
    setPreview(dataUrl);
    setFailMsg("");
    const res = await checkFaceInPhoto(dataUrl);
    if (!res.ok) { setPreview(null); setFailMsg(res.reason); return; }
    onCaptured(file);
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !faceInOval) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    canvas.toBlob((blob) => {
      if (blob) runCheck(new File([blob], "labour-punch.jpg", { type: "image/jpeg" }), canvas.toDataURL("image/jpeg", 0.9));
    }, "image/jpeg", 0.9);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => runCheck(file, ev.target.result);
    reader.readAsDataURL(file);
  }

  return createPortal(
    <div className="fixed inset-0 z-[9000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4">
      <div className="bg-white shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-md rounded-none sm:rounded-2xl p-5 sm:p-6 flex flex-col sm:block overflow-y-auto relative">
        {!busy && (
          <button onClick={onCancel} title="Cancel (Esc)"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition z-10">
            <IconX size={16} />
          </button>
        )}
        <div className="flex items-start gap-3 pr-10">
          <div className={"w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 " + (type === "in" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-700")}>
            <IconCamera size={22} />
          </div>
          <div className="min-w-0 pt-1">
            <h3 className="text-xl font-bold text-gray-900 truncate">{type === "in" ? "Punch In" : "Punch Out"} · {labour.name}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{labour.department} — take {labour.name.split(" ")[0]}'s photo.</p>
          </div>
        </div>

        <div className="mt-4 flex-1 flex flex-col min-h-0 sm:flex-none sm:block">
          {busy || preview ? (
            <div className="relative rounded-xl overflow-hidden bg-black flex-1 sm:flex-none sm:aspect-square sm:max-w-[280px] sm:mx-auto">
              {preview && <img src={preview} alt="" className="w-full h-full object-cover opacity-70" />}
              <div className="absolute inset-0 flex items-center justify-center text-white text-sm font-medium">{busy ? "Saving punch…" : "Checking photo…"}</div>
            </div>
          ) : cameraError ? (
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-10 flex-1 sm:flex-none cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 transition">
              <IconCamera size={28} />
              <span className="text-sm font-semibold text-gray-600">Open Camera</span>
              {cameraError === "denied" && <span className="text-xs text-amber-600 px-6 text-center">Camera access was blocked — allow it for this site, or pick a photo instead.</span>}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
            </label>
          ) : (
            <div className="relative rounded-xl overflow-hidden bg-black flex-1 sm:flex-none sm:aspect-square sm:max-w-[280px] sm:mx-auto">
              {/* Mirrored only for the front camera, where a mirror preview is what people expect. */}
              <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setVideoReady(true)}
                className={"w-full h-full object-cover " + (facing === "user" ? "-scale-x-100" : "")} />
              {videoReady && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className={"w-[70%] h-[70%] sm:w-[60%] sm:h-[80%] rounded-[50%] border-[3px] transition-colors duration-200 " + (faceInOval ? "border-green-400" : "border-white/50")}
                    style={{ boxShadow: "0 0 0 1000px rgba(0,0,0,0.35)" }} />
                </div>
              )}
              <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} title="Switch camera"
                className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/55 text-white text-xs font-semibold hover:bg-black/70 transition">
                ⟲ Flip
              </button>
            </div>
          )}
          {live && (
            <button onClick={capture} disabled={!videoReady || !faceInOval}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex-shrink-0">
              <IconCamera size={16} /> Take Photo & {type === "in" ? "Punch In" : "Punch Out"}
            </button>
          )}
          {live && videoReady && !faceInOval && <p className="text-xs text-gray-400 mt-2 text-center">Line their face up inside the oval</p>}
          {failMsg && <p className="text-sm text-red-600 mt-3 text-center">{failMsg}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
