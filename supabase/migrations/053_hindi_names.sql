-- Hindi spellings of data names for the Hindi Dept Ops PDF (IMS Planning → Dept Ops → EN | हिं).
-- The owner wants the Hindi book to print item, zone, colour, flower, client and venue names in
-- Devanagari as the crew says them — a transliteration ("Chivari Chair" → "चिवारी चेयर"), not a
-- translation. lib/ims/hindiNames.js asks the AI for any name it has not seen, once, and keeps the
-- answer here so every later book (on any device) reuses it instead of asking again.
--
-- en: the English name, trimmed, spaces collapsed, lower-cased (the lookup key).
-- hi: its Devanagari spelling. A wrong one can be fixed by editing the row.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS hindi_names (
  en TEXT PRIMARY KEY,
  hi TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Same `ambria_authenticated_all` policy as every other table (logged-in Supabase Auth session only).
ALTER TABLE public.hindi_names ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_authenticated_all ON public.hindi_names;
CREATE POLICY ambria_authenticated_all ON public.hindi_names FOR ALL TO authenticated USING (true) WITH CHECK (true);
