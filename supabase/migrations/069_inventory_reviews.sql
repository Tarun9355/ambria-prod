-- IMS Inventory "New / edited" check list (owner ask 2026-11-17): every item someone adds or edits shows in a list until an
-- admin has cross-checked it. One row per item = the version (inventory.updated_at) the admin last checked and who did it.
-- An item is due again when its updated_at moves past reviewed_version (edited after the check). Kept out of `inventory`
-- itself on purpose: marking an item checked must not touch the item row, or its own updated_at (trigger, 001) would move
-- and it would never leave the list.

CREATE TABLE IF NOT EXISTS public.inventory_reviews (
  item_id TEXT PRIMARY KEY,
  reviewed_version TIMESTAMPTZ NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: same convention as every other table since 048 - logged-in session only.
ALTER TABLE public.inventory_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_authenticated_all ON public.inventory_reviews;
CREATE POLICY ambria_authenticated_all ON public.inventory_reviews FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Realtime: one admin's check clears the item from everyone's list live.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_reviews;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
