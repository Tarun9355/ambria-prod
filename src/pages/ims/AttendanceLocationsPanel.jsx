import { useState } from "react";
import { IconPin, IconX } from "../../components/icons.jsx";

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
export default function AttendanceLocationsPanel({ settings, setSettings }) {
  const locations = settings?.attendanceLocations || [];
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
    setSettings((s) => ({
      ...s,
      attendanceLocations: [...(s.attendanceLocations || []), { id: "loc" + Date.now(), name: name.trim(), lat: la, lng: ln }],
    }));
    setName(""); setLat(""); setLng(""); setError("");
  }

  function removeLocation(id) {
    setSettings((s) => ({ ...s, attendanceLocations: (s.attendanceLocations || []).filter((l) => l.id !== id) }));
  }

  // Google Maps' own "copy coordinates" gives one string like "28.6139, 77.2090" — pasting that
  // into the Latitude box splits it across both fields instead of leaving Longitude empty.
  function handleLatPaste(e) {
    const text = e.clipboardData?.getData("text") || "";
    const m = text.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (m) { e.preventDefault(); setLat(m[1]); setLng(m[2]); }
  }

  return (
    <div className="mt-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-lg font-bold text-gray-900">Punch Locations</h3>
        {locations.length > 0 && (
          <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{locations.length}</span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        A punch within 300m of one of these is tagged with its name; anywhere else is logged as "Unknown location".
      </p>

      {locations.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No locations set yet.</p>
      ) : (
        <div className="space-y-1.5 mb-5">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-gray-100 hover:bg-gray-50 transition">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <IconPin size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-800 truncate">{loc.name}</div>
                <div className="text-xs text-gray-400">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</div>
              </div>
              <button onClick={() => removeLocation(loc.id)} title="Remove"
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
                <IconX size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add a location</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Ambria Exotica)"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input value={lat} onChange={(e) => setLat(e.target.value)} onPaste={handleLatPaste}
            placeholder="Latitude (or paste 'lat, lng')" inputMode="decimal"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
          <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" inputMode="decimal"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        </div>
        <button onClick={captureHere} disabled={capturing}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50 transition">
          <IconPin size={13} /> {capturing ? "Getting your location…" : "Use my current location"}
        </button>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div>
          <button onClick={addLocation}
            className="mt-4 w-full sm:w-auto px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition">
            Add location
          </button>
        </div>
      </div>
    </div>
  );
}
