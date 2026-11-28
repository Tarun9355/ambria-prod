import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// userAdmin imports the live supabase client (which throws without env vars) - nothing is created in a render.
vi.mock("../../lib/userAdmin", () => ({ callUserAdmin: async () => ({}) }));
const { default: StaffImportModal } = await import("./StaffImportModal.jsx");

describe("StaffImportModal", () => {
  it("opens on the file picker, says what it does, creates nothing yet", () => {
    const html = renderToStaticMarkup(<StaffImportModal open onClose={() => {}} users={[]} settings={{}} setSettings={() => {}} />);
    expect(html).toContain("Import staff from a sheet");
    expect(html).toContain("Choose the CSV file");
    expect(html).toContain("Labour");
    expect(html).toContain('type="file"');
    expect(html).not.toContain("Create ");
  });
  it("renders nothing when closed", () => {
    expect(renderToStaticMarkup(<StaffImportModal open={false} onClose={() => {}} users={[]} settings={{}} setSettings={() => {}} />)).toBe("");
  });
});
