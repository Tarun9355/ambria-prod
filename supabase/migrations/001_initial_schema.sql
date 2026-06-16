-- ═══ AMBRIA V2 — INITIAL SCHEMA ═══
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query → Paste → Run)

-- ── INVENTORY ──
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  cat TEXT,
  sub_cat TEXT,
  item_class TEXT DEFAULT 'discrete',
  type TEXT,
  unit TEXT DEFAULT 'Pieces',
  qty INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  price NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  breakage_pct NUMERIC DEFAULT 0,
  location TEXT,
  img TEXT,
  photo_urls TEXT[] DEFAULT '{}',
  dims JSONB,
  base_colour TEXT,
  paint_cost NUMERIC DEFAULT 0,
  is_kit BOOLEAN DEFAULT false,
  sub_items JSONB DEFAULT '[]',
  notes TEXT,
  flags JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- ── MANDI FLOWERS ──
CREATE TABLE IF NOT EXISTS mandi_flowers (
  id TEXT PRIMARY KEY,
  flower_cat TEXT,
  name TEXT NOT NULL,
  unit TEXT DEFAULT 'bundle',
  pcs_per_unit INTEGER,
  current_price NUMERIC DEFAULT 0,
  photo_url TEXT,
  color_variants JSONB DEFAULT '[]',
  price_history JSONB DEFAULT '[]',
  preferences JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- ── FLOWER PATTERNS ──
CREATE TABLE IF NOT EXISTS flower_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  flat_or_smb TEXT DEFAULT 'smb',
  markup NUMERIC DEFAULT 4,
  sizes JSONB NOT NULL DEFAULT '{}',
  dihari JSONB DEFAULT '{}',
  visual_count JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- ── PROJECTS ──
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT,
  venue TEXT,
  status TEXT DEFAULT 'active',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── FUNCTIONS ──
CREATE TABLE IF NOT EXISTS functions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT,
  date TEXT,
  venue TEXT,
  status TEXT DEFAULT 'pending',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── EVENT ORDERS ──
CREATE TABLE IF NOT EXISTS event_orders (
  id TEXT PRIMARY KEY,
  client_name TEXT,
  event_id TEXT,
  fn_id TEXT,
  status TEXT DEFAULT 'pending',
  items JSONB DEFAULT '[]',
  manual_items JSONB DEFAULT '[]',
  decisions JSONB DEFAULT '{}',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── USERS ──
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT DEFAULT 'Sales',
  permissions TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── VENDORS ──
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  contact TEXT,
  email TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── PURCHASE ORDERS ──
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  vendor_id TEXT,
  amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending',
  items JSONB DEFAULT '[]',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── SUPERVISORS ──
CREATE TABLE IF NOT EXISTS supervisors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  active BOOLEAN DEFAULT true
);

-- ── PRODUCTION REQUESTS ──
CREATE TABLE IF NOT EXISTS production_requests (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  fn_id TEXT,
  status TEXT DEFAULT 'pending',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── OVERHEADS ──
CREATE TABLE IF NOT EXISTS overheads (
  id TEXT PRIMARY KEY,
  name TEXT,
  amount NUMERIC DEFAULT 0,
  category TEXT,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── CATEGORIES ──
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0
);

-- ── SETTINGS (key-value) ──
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- ── BLOCKS ──
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  date TEXT,
  item_id TEXT,
  qty INTEGER DEFAULT 0,
  fn_id TEXT,
  project_id TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── TRUSS INVENTORY ──
CREATE TABLE IF NOT EXISTS truss_inventory (
  key TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── TRUSS ALLOCATIONS ──
CREATE TABLE IF NOT EXISTS truss_allocations (
  date TEXT PRIMARY KEY,
  events JSONB DEFAULT '[]',
  pool JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── BOXES ──
CREATE TABLE IF NOT EXISTS boxes (
  id TEXT PRIMARY KEY,
  name TEXT,
  items JSONB DEFAULT '[]',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── STUDIO EVENTS ──
CREATE TABLE IF NOT EXISTS studio_events (
  id TEXT PRIMARY KEY,
  name TEXT,
  client TEXT,
  venue TEXT,
  img TEXT,
  functions JSONB DEFAULT '[]',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── RATE CARD ──
CREATE TABLE IF NOT EXISTS rate_card (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cat TEXT,
  sub TEXT,
  unit TEXT,
  inhouse_mode TEXT DEFAULT 'flat',
  inhouse_flat NUMERIC DEFAULT 0,
  inhouse_s NUMERIC DEFAULT 0,
  inhouse_m NUMERIC DEFAULT 0,
  inhouse_b NUMERIC DEFAULT 0,
  out_s NUMERIC DEFAULT 0,
  out_m NUMERIC DEFAULT 0,
  out_b NUMERIC DEFAULT 0,
  zones TEXT[] DEFAULT '{}',
  floral_mode TEXT,
  default_real_pct NUMERIC,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── RATE CARD CATEGORIES ──
CREATE TABLE IF NOT EXISTS rate_card_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  subs JSONB DEFAULT '[]'
);

-- ── LIBRARY ──
CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY,
  name TEXT,
  url TEXT,
  tags JSONB DEFAULT '{}',
  elements JSONB DEFAULT '[]',
  dims JSONB DEFAULT '{}',
  linked_templates JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── TEMPLATES ──
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT,
  zones JSONB DEFAULT '[]',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── CLIENT LEDGER ──
CREATE TABLE IF NOT EXISTS client_ledger (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  status TEXT DEFAULT 'ongoing',
  budget NUMERIC DEFAULT 0,
  created_by TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── AUDIT LOG ──
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT,
  row_id TEXT,
  action TEXT,
  old_data JSONB,
  new_data JSONB,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ AUTO-UPDATE TIMESTAMPS ═══
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'inventory','mandi_flowers','flower_patterns','projects','functions',
    'event_orders','vendors','purchase_orders','settings','blocks',
    'truss_inventory','truss_allocations','boxes','studio_events',
    'rate_card','library','client_ledger'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_timestamp ON %I', t);
    EXECUTE format('CREATE TRIGGER set_timestamp BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_timestamp()', t);
  END LOOP;
END $$;

-- ═══ ENABLE REALTIME ═══
ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE mandi_flowers;
ALTER PUBLICATION supabase_realtime ADD TABLE flower_patterns;
ALTER PUBLICATION supabase_realtime ADD TABLE event_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE settings;
ALTER PUBLICATION supabase_realtime ADD TABLE blocks;
ALTER PUBLICATION supabase_realtime ADD TABLE studio_events;
ALTER PUBLICATION supabase_realtime ADD TABLE rate_card;
ALTER PUBLICATION supabase_realtime ADD TABLE library;
ALTER PUBLICATION supabase_realtime ADD TABLE client_ledger;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE functions;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
