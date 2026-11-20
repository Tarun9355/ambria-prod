import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Owner report 2026-11-20: after login the IMS rail showed a guessed tab list (a role's built-in default) and swapped to the real
// one when the settings arrived. Until IMS has loaded, both rails (desktop and the phone drawer) show placeholder rows instead.
const src = readFileSync(resolve(__dirname, "IMS.jsx"), "utf8").replace(/\r\n/g, "\n");

describe("IMS rail while loading", () => {
  it("both the desktop rail and the phone drawer show the skeleton, never the tab list, while `loading`", () => {
    const navs = src.split("\n").filter((l) => l.includes("<IMSNav tabs={allowedTabs}"));
    expect(navs).toHaveLength(2);
    navs.forEach((l) => expect(l).toContain("{loading ? <NavSkeleton /> : <IMSNav"));
  });
  it("the skeleton has no tab labels, is marked busy for assistive tech, and respects reduced motion", () => {
    const a = src.indexOf("function NavSkeleton()");
    const body = src.slice(a, src.indexOf("\n}\n", a));
    expect(body).toContain('aria-busy="true"');
    expect(body).toContain("motion-reduce:animate-none");
    for (const label of ["Attendance", "Planning", "Inventory", "Site", "Dashboard"]) expect(body).not.toContain(label);
    expect(body).not.toContain("style={{"); // Tailwind only
  });
  it("`loading` starts true and is only cleared after the data (settings included) has been applied", () => {
    expect(src).toMatch(/const \[loading, setLoading\] = useState\(true\);/);
    const done = src.indexOf("setLoading(false);");
    expect(done).toBeGreaterThan(src.indexOf('safeFetch("settings")'));
  });
});
