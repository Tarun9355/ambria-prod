// Site page (sidebar → Site): the calendar has a "👷 My events" button (owner ask 2026-11-25), off to start with - every event shows
// until it is tapped. The filter itself is lib/ims/mySupervisorEvents (isMyEvent / fixedAtVenue), tested there.
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }, fetchAll: () => Promise.resolve([]) }));
import SiteSupervisorTab from "./SiteSupervisorTab.jsx";

describe("Site page calendar: My events", () => {
  it("shows the My events button, not pressed, and every event of the month", () => {
    const d = new Date(); const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
    const eo = (id, name) => ({ id, clientName: name, status: "confirmed", date: ds, functionsDetail: [{ date: ds, venue: "Grand" }] });
    const html = renderToString(<SiteSupervisorTab eventOrders={[eo("E1", "Raju Wedding"), eo("E2", "Mehta")]} setEventOrders={() => {}} inventory={[]} settings={{}}
      authUser={{ name: "Chandan", phone: "9000000002" }} supervisors={[{ id: "S2", name: "Chandan", phone: "9000000002" }]} />);
    expect(html).toContain("My events");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Raju Wedding");
    expect(html).toContain("Mehta");
    // the Planning calendar's venue colours and legend: an outside venue (not one of Ambria's fixed ones) is "ADD", sky
    expect(html).toContain("border-sky-400");
    expect(html).toContain(">ADD<");
    expect(html).toContain("Pushpanjali"); // the legend
    expect(html).not.toContain("border-blue-500 bg-blue-50/80"); // the old all-blue chip
  });
});
