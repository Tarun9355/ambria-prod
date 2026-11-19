// "My events" for a site supervisor who logs in to IMS (owner ask 2026-11-19): Planning → Dept Ops' calendar gets a button that shows
// only the events this person is the Site Supervisor of (the 👷 Site Supervisor picked on the event's header).
//
// The login (users table) and the roster (supervisors table, Admin → Settings → 👷 Supervisors) are two lists with no id between
// them, so a person is the same when their phone numbers are the same (last 10 digits, when both have one), else when their names
// are the same (case and spacing ignored).

const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "").slice(-10);
const nameKey = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();

// two { name, phone } are the same person
export function samePerson(a, b) {
  const pa = digits(a?.phone), pb = digits(b?.phone);
  if (pa.length === 10 && pb.length === 10) return pa === pb;
  const na = nameKey(a?.name);
  return !!na && na === nameKey(b?.name);
}

// the roster rows (ids) that are this login
export function supervisorIdsOfUser(user, supervisors) {
  return (Array.isArray(supervisors) ? supervisors : []).filter((s) => s && s.id != null && samePerson(user, s)).map((s) => s.id);
}

// is this event order one of this login's? Its picked supervisor's id is one of theirs, or - when that supervisor has since left the
// roster - the name / phone the event kept (siteSupervisorName / siteSupervisorPhone) is theirs.
export function isMyEvent(eo, user, supervisors) {
  if (!eo) return false;
  if (eo.siteSupervisorId != null && eo.siteSupervisorId !== "") {
    if (supervisorIdsOfUser(user, supervisors).includes(eo.siteSupervisorId)) return true;
    const onRoster = (Array.isArray(supervisors) ? supervisors : []).some((s) => s && s.id === eo.siteSupervisorId);
    if (onRoster) return false; // a supervisor on the roster who is somebody else
  }
  if (!eo.siteSupervisorName && !eo.siteSupervisorPhone) return false;
  return samePerson(user, { name: eo.siteSupervisorName, phone: eo.siteSupervisorPhone });
}
