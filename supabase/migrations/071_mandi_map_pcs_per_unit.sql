-- Mapping flowers: how many pieces of the mapped artificial inventory item stand in for 1 unit (kg,
-- bundle…) of the real flower (owner ask 2026-11-20: a mapped item must show in Floral's Inventory
-- blocked list and the truck list, and be reserved in `blocks` like every other item — which needs
-- the qty in the item's own pieces, not the real flower's kg).
--
-- NULL = 1, which is exactly what every pricing path assumed until now (1 unit of real flower = 1
-- piece of the mapped item), so running this changes no price on its own. Safe to re-run.

ALTER TABLE public.mandi_flowers ADD COLUMN IF NOT EXISTS artificial_map_pcs_per_unit NUMERIC;
