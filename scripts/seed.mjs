// Seed the default admin user into Supabase.
// Reads VITE_ vars from .env.local and upserts DEFAULT_ADMIN (tarun / ambria@admin),
// matching the reference IMS app's DEFAULT_ADMIN exactly.
//
//   node scripts/seed.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const admin = { id: "u_admin", name: "Tarun", username: "tarun", password: "ambria@admin", role: "Admin", active: true };

const { data, error } = await supabase.from("users").upsert(admin, { onConflict: "id" }).select().single();
if (error) {
  console.error("SEED FAILED:", error.message);
  console.error("(If this is an RLS/permission error, run the equivalent INSERT in the Supabase SQL editor instead.)");
  process.exit(1);
}
console.log("✓ Seeded admin user:", data.username, "·", data.role);

// Quick read-back to confirm login query path works.
const { data: check, error: checkErr } = await supabase
  .from("users").select("username,role,active").eq("username", "tarun").eq("active", true).maybeSingle();
if (checkErr) { console.error("Read-back failed:", checkErr.message); process.exit(1); }
console.log("✓ Login query returns:", JSON.stringify(check));
