-- ─── Rate Card → IMS migration, follow-up: per-sub-category cost% for unavailable items ──────
-- Deal Check bills a matched card's shortfall (qty beyond what's actually free in stock for the
-- event date) at `item.cost × this percentage` instead of the rental rate. No clean "no-op"
-- default exists here the way 1.0 was for scaling_factor — 100 means "charge full production
-- cost on shortfall," a safe starting point pending your review per sub-category.

ALTER TABLE rate_card_categories
  ADD COLUMN IF NOT EXISTS cost_percent NUMERIC NOT NULL DEFAULT 100;
