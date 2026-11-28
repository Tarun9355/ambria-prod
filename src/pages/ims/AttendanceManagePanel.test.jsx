import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The live supabase client throws without env vars - nothing is read or written in a render.
vi.mock("../../lib/supabase", () => ({ supabase: {}, subscribeTable: () => ({}), fetchAll: async () => [] }));
vi.mock("../../lib/userAdmin", () => ({ callUserAdmin: async () => ({}) }));
const { default: AttendanceManagePanel } = await import("./AttendanceManagePanel.jsx");

const users = [
  { id: "u_admin", name: "Tarun", role: "Admin", phone: "9999999999" },
  { id: "u1", name: "Krati", role: "Dept Head - Floral", phone: "9811111111", username: "krati" },
];

describe("AttendanceManagePanel", () => {
  it("shows staff with their role, department and phone, and the add / import actions", () => {
    const html = renderToStaticMarkup(<AttendanceManagePanel authUser={users[0]} users={users} setUsers={() => {}} settings={{}} />);
    expect(html).toContain("Manage people");
    expect(html).toContain("Add labour");
    expect(html).toContain("Add staff");
    expect(html).toContain("Import sheet");
    expect(html).toContain("Everyone");
  });
});
