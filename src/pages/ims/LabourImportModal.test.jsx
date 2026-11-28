import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// labourAttendance imports the live supabase client (which throws without env vars) - nothing is read or written in a render.
vi.mock("../../lib/supabase", () => ({ supabase: {}, fetchAll: async () => [] }));
const { default: LabourImportModal } = await import("./LabourImportModal.jsx");

describe("LabourImportModal", () => {
  it("opens on the file picker and says nobody logs in", () => {
    const html = renderToStaticMarkup(<LabourImportModal open onClose={() => {}} authUser={{ id: "u_admin", role: "Admin" }} />);
    expect(html).toContain("Import labours from a sheet");
    expect(html).toContain("Choose the CSV file");
    expect(html).toContain("Nobody logs in");
    expect(html).toContain('type="file"');
  });
});
