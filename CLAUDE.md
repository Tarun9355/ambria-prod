# CLAUDE.md — Ambria V2 Project Instructions

## What is this project?
Ambria is a wedding & event décor management platform with two user-facing sections:
- **Studio** (`/studio`) — used by 8 salespeople for quoting, deal-building, client presentations
- **IMS** (`/ims`) — used by 40 ops staff for inventory, manpower, flowers, finance, production

## Tech Stack
- **Framework:** Next.js 15 (App Router)
- **UI:** React 19 + Tailwind CSS v4
- **Database:** Supabase (PostgreSQL + Realtime)
- **Hosting:** Vercel
- **CI/CD:** GitHub Actions
- **Media:** Cloudinary (cloud dy9wfqhry)
- **AI:** Anthropic Claude API (image tagging)

## Supabase Connection
- Project URL: `https://taalribntdkowoqltvqw.supabase.co`
- Use `src/lib/supabase.js` for all database operations
- NEVER hardcode keys — use env vars
- Real-time subscriptions via `subscribeTable()` helper

## Key Architecture Rules

1. **Row-level updates only** — NEVER fetch entire table + modify + save back. Use `updateRow(table, id, changes)` for individual rows.
2. **Real-time subscriptions** — Every page with shared data subscribes via `subscribeTable()`. On change event, update React state for just that row.
3. **No JSON blobs for flat data** — Use proper columns. JSONB only for truly nested data (element lists, zone configs).
4. **Component-per-feature** — Each tab/feature = own file. No giant single files.
5. **Tailwind only** — No inline styles.
6. **Server Components by default** — `"use client"` only when needed.

## Project Structure
```
src/
├── app/
│   ├── layout.jsx              # Root layout
│   ├── page.jsx                # Landing → /studio or /ims
│   ├── studio/                 # Sales team pages
│   │   ├── page.jsx            # Studio home (event cards)
│   │   ├── manage/page.jsx     # Event management
│   │   ├── library/page.jsx    # Photo library + AI tagging
│   │   ├── pricing/page.jsx    # Rate card editor
│   │   └── settings/page.jsx   # Studio settings
│   ├── ims/                    # Ops team pages
│   │   ├── page.jsx            # Dashboard
│   │   ├── inventory/page.jsx  # Inventory CRUD
│   │   ├── events/page.jsx     # Event orders
│   │   ├── flowers/page.jsx    # Mandi prices + recipes
│   │   ├── planning/page.jsx   # Function planning
│   │   ├── finance/page.jsx    # P&L, overheads
│   │   └── admin/page.jsx      # Users, roles, settings
│   └── api/                    # Server-side API routes
├── lib/
│   ├── supabase.js             # DB client + helpers
│   └── utils.js                # Shared utilities
└── components/                 # Shared UI components
    ├── ui/                     # Buttons, inputs, modals
    └── shared/                 # Business components
```

## Database Tables

### Shared (Studio + IMS):
- `inventory` — 600+ items (qty, price, location, dims, photos)
- `event_orders` — Studio deals → IMS ops bridge
- `mandi_flowers` — flower prices + photos + variants
- `flower_patterns` — recipes (flowers per arrangement)
- `blocks` — date-indexed inventory reservations

### IMS-only:
- `projects`, `functions`, `users`, `vendors`, `purchase_orders`
- `supervisors`, `production_requests`, `overheads`, `categories`
- `settings` (key-value), `truss_inventory`, `truss_allocations`, `boxes`

### Studio-only:
- `studio_events`, `rate_card`, `rate_card_categories`
- `library`, `templates`, `client_ledger`

### System:
- `audit_log` — auto change tracking

## Team
- **Owner:** Tarun (sales@ambria.in), Delhi
- **Ops:** Krati, Ajay, Sudhir (Floral Head), Aman, Anmol
- **Sales:** 8 people including Ashi, Jitanshu, Himanshu
- **Currency:** Indian Rupee (₹)

## UI Style
- Chips/pills over dropdowns
- Desktop-first, mobile-responsive
- Functional components + hooks only
- Clean, modern, minimal
