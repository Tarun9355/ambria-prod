import { useState } from "react";
import { IconPin, IconX } from "../../components/icons.jsx";
import { useConfirm } from "../../components/ui";
import { supabase, deleteRow } from "../../lib/supabase";

// ═══════════════════════════════════════════════════════════════════════════
// MANAGE LOCATIONS — admin-editable list of named punch-in locations (Ambria Exotica, Manaktala,
// Pushpanjali, the godown, …), each just a name + coordinates. A punch within 300m of one is
// tagged with its name (resolvePunchLocation, lib/ims/attendance.js); anywhere else is logged as
// "Unknown location" with its own raw coordinates still saved.
//
// No manual coordinate lookup needed: "Use my current location" reads the ADMIN'S OWN device GPS
// right here — stand at the real place, tap it, name it, save. That's also how a location added
// later (the godown, a new venue) gets set up — no address or map lookup required from anyone.
// ═══════════════════════════════════════════════════════════════════════════
export default function AttendanceLocationsPanel({ settings }) {
  const locations = settings?.attendanceLocations || [];
  const [confirm, confirmDialog] = useConfirm();
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");

  function captureHere() {
    if (!navigator.geolocation) { setError("This device/browser doesn't support location."); return; }
    setCapturing(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(String(pos.coords.latitude)); setLng(String(pos.coords.longitude)); setCapturing(false); },
      (err) => { setError(err?.message || "Couldn't get your location — check the browser's location permission."); setCapturing(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function addLocation() {
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (!name.trim()) { setError("Give it a name first."); return; }
    if (!Number.isFinite(la) || !Number.isFinite(ln)) { setError("Capture your current position, or enter both coordinates, first."); return; }
    supabase.from("attendance_locations").insert({ id: "loc" + Date.now(), name: name.trim(), lat: la, lng: ln }).then(() => {}, () => {});
    setName(""); setLat(""); setLng(""); setError("");
  }

  async function removeLocation(id) {
    const loc = locations.find((l) => l.id === id);
    if (!(await confirm({ title: `Remove ${loc?.name ? `"${loc.name}"` : "this location"}?`, body: "Staff will no longer be able to punch in at this location." }))) return;
    deleteRow("attendance_locations", id).catch(() => {});
  }

  // Google Maps' own "copy coordinates" gives one string like "28.6139, 77.2090" — pasting that
  // into the Latitude box splits it across both fields instead of leaving Longitude empty.
  function handleLatPaste(e) {
    const text = e.clipboardData?.getData("text") || "";
    const m = text.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (m) { e.preventDefault(); setLat(m[1]); setLng(m[2]); }
  }

  const input = "h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";
  const hasCoords = Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng));

  return (
    <div className="space-y-5">
      {confirmDialog}
      {/* ── THE LIST ── every named place a punch can be tagged with. */}
      <section aria-label="Punch locations" className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
        <div className="px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <IconPin size={15} /> Punch locations
            {locations.length > 0 && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">{locations.length}</span>}
          </h3>
          <p className="mt-1 text-xs text-gray-500">A punch within 300m of one of these is tagged with its name; anywhere else is logged as "Unknown location".</p>
        </div>
        <div className="border-t border-gray-100">
          {locations.length === 0 ? (
            <div className="py-10 text-center px-5">
              <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><IconPin size={18} /></div>
              <p className="mt-3 text-sm font-medium text-gray-700">No locations set yet</p>
              <p className="mt-1 text-xs text-gray-500">Add the venues and the godown below, so punches there are named.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {locations.map((loc) => (
                <li key={loc.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <span aria-hidden="true" className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><IconPin size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 truncate">{loc.name}</div>
                    {/* Opens the spot in Google Maps, to check a saved position is the right place. */}
                    <a href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer"
                      className="text-xs text-gray-500 tabular-nums hover:text-blue-700 hover:underline underline-offset-2">
                      {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                    </a>
                  </div>
                  <button onClick={() => removeLocation(loc.id)} aria-label={`Remove ${loc.name}`} title="Remove"
                    className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors">
                    <IconX size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── ADD ONE ── stand at the place and tap "Use my current location", or paste coordinates. */}
      <section aria-label="Add a location" className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Add a location</h3>
          <p className="mt-1 text-xs text-gray-500">Easiest on site: stand at the place, tap "Use my current location", name it, save.</p>
        </div>
        <div className="border-t border-gray-100 px-5 py-4 space-y-3">
          <div>
            <label htmlFor="loc-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ambria Exotica" className={input} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="loc-lat" className="block text-xs font-medium text-gray-700 mb-1">Latitude</label>
              <input id="loc-lat" value={lat} onChange={(e) => setLat(e.target.value)} onPaste={handleLatPaste}
                placeholder="or paste 'lat, lng'" inputMode="decimal" className={input + " tabular-nums"} />
            </div>
            <div>
              <label htmlFor="loc-lng" className="block text-xs font-medium text-gray-700 mb-1">Longitude</label>
              <input id="loc-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="e.g. 77.2090" inputMode="decimal" className={input + " tabular-nums"} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={captureHere} disabled={capturing}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 disabled:cursor-wait">
              {capturing
                ? <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
                : <IconPin size={14} />}
              {capturing ? "Getting your location…" : "Use my current location"}
            </button>
            {hasCoords && !capturing && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 ring-1 ring-green-200 px-2.5 py-0.5 text-xs font-medium text-green-800">Position set</span>
            )}
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="pt-1">
            <button onClick={addLocation}
              className="inline-flex items-center justify-center gap-2 h-10 px-5 w-full sm:w-auto rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
              Add location
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
