import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Helpers ───────────────────────────────────────────

/** Fetch all rows from a table */
export const fetchAll = async (table) => {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw error;
  return data || [];
};

/** Fetch a single row by ID */
export const fetchById = async (table, id) => {
  const { data, error } = await supabase.from(table).select("*").eq("id", id).single();
  if (error) throw error;
  return data;
};

/** Upsert (insert or update) a row */
export const upsertRow = async (table, row) => {
  const { data, error } = await supabase
    .from(table)
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** Update specific fields on a row */
export const updateRow = async (table, id, changes) => {
  const { data, error } = await supabase
    .from(table)
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** Delete a row by ID */
export const deleteRow = async (table, id) => {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
};

/** Subscribe to real-time changes on a table */
export const subscribeTable = (table, callback) => {
  return supabase
    .channel(`realtime:${table}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, callback)
    .subscribe();
};

/** Subscribe to changes on a specific row */
export const subscribeRow = (table, id, callback) => {
  return supabase
    .channel(`realtime:${table}:${id}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter: `id=eq.${id}` }, callback)
    .subscribe();
};
