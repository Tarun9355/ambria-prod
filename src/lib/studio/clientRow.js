// Also imported directly (relative path) by the `lms-relink` Supabase Edge Function (Deno) via
// lmsRelinkRun.js — keep this plain JS, no non-relative or extensionless imports.

// ═══ Client ledger ↔ `client_ledger` TABLE mapper (migrated off the settings blob) ═══
// Full client object in `data`; typed columns (name/phone/email/status/budget/created_by) mirrored.
export function rowToClient(row) {
  if (!row) return null;
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length) ? row.data : null;
  const base = d ? { ...d, id: row.id } : { id: row.id, name: row.name, phone: row.phone, email: row.email, budget: row.budget };
  // sessions defaults to [] because the blob no longer carries them (see clientToRow) — they are
  // filled in from studio_sessions by the loader. Without this a freshly-read client would have
  // `sessions: undefined` between the two steps, and every `c.sessions.length` in the app would
  // throw rather than read as "no saves yet".
  return { sessions: [], ...base, id: row.id, status: base.status || row.status || "ongoing", createdBy: base.createdBy || row.created_by || "—" };
}
