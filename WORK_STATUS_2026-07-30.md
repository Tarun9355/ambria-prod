# Work status — 30 Jul 2026

## Shipped (7 commits, all deployed green)

| Commit | What |
|---|---|
| `80e3713` | Build: removed the per-zone duplicate (copy) button |
| `99bd62f` | Build: "+ Add Zone" is now a zone-type picker with auto-naming; destructive confirms are a centred dialog, not a browser `alert()` |
| `949d646` | Venue smart-search + "See all" in both Build's rail and Browse; `"Both"` venue type now displays **Indoor + Outdoor**; verified star requires elements; verified photos sort first |
| `c815630` | Recipes panel shows which variant price each ingredient is costed at (`↓N` = cheapest of N) |
| `4ada935` | **Kit pricing: floral components are now charged.** Header price matches the breakdown |
| `e9e1da6` | **Wipe-proofing:** `kvTryGet`, both blob savers abort on a failed read; five dead blobs retired |
| `cbe6bdb` | **Video tags moved from a blob to one row per video** |

## Incident — video tag loss and recovery

**What happened.** `ambria-yt-tags-v1` went from 428 records to 2 at ~16:01 IST. 249 human verifications lost.

**Cause.** `kvGet` returns `null` for a failed read *and* for a missing row — it cannot tell them apart. `saveYtTags` treated that `null` as "no tags exist", merged the single-video patch onto an empty map, and wrote the result as the whole map. One failed request during one video's edit therefore erased all 427 others. Silently: the old code swallowed the error.

The same function had already been fixed once, two days earlier (`ce607a4`, "Fix video verifications reverting on refresh"). That fix was correct but left this hole, and made the failure mode *worse* — the earlier bug lost one tab's view of other people's edits, this one could zero the map.

**Recovery.** Supabase point-in-time rollback to 29 Jul, then 114 rows of 30 Jul work re-applied from a verified local backup with the tags key excluded by name. Guard added so the restore could never overwrite a row newer than the backup — it held back 6 such rows, including three client sessions being edited during the restore.

**Deliberately not restored** (owner's decision): the 100 video hides (`ambria-hidden-videos-v1`) and `ambria-yt-cache-v1`.

**Backups on disk** (outside the repo, contain `users` + `client_ledger` — treat as sensitive):
```
C:\Users\hp\Desktop\ambria-backup-2026-07-30-1600        pre-rollback
C:\Users\hp\Desktop\ambria-backup-POSTROLLBACK-2026-07-30 post-rollback safety net
C:\Users\hp\Desktop\ambria-verify-after-cleanup           after blob cleanup
```
All three verified complete against exact server-side row counts.

## Database changes

**Migration 023 applied** — `video_tags` table, one row per video. 428 rows backfilled, 249 verified, **zero field mismatches**, and a live round-trip through the adapter matched on all 19 fields. Reads come from the table, writes are per-row upsert/delete, realtime is row-level. The legacy blob is still mirrored on every save as a one-release fallback.

**Five dead blobs deleted — 5.88 MB.** Verified unread first (no `kvGet`/`reliableSave`/realtime path referenced any of them):
`ambria-library-v2` (5.5 MB, 29 Jun stale) · `ambria-clients-v1` · `ambria-ratecard-v4` · `ambria-eventorders-v1` · `ambria-ims-blocks-v1`. Their constants were removed from `keys.js`/`IMS.jsx`, and `src/scripts/rebuild-library.js` is guarded — it targeted one of them.

## Behaviour changes the team should know

1. **Kit prices went up.** Kits containing floral components roughly double (one console kit ₹3,746 → ₹7,715). Nothing is snapshotted, so **saved deals re-price when reopened.** Tell sales before a client sees it.
2. **All 428 videos are visible again** — the 100 hides weren't restored, so Untagged / Needs-review now include the 2017–2021 back catalogue.
3. `"Both"` venue type reads **Indoor + Outdoor** everywhere (stored value unchanged, no re-tagging).
4. The green verified star on Build photos now needs elements as well as a verification.
5. A video with an empty function list (`fn: []`) no longer counts as tagged. Judged correct, but it can move a video from Needs-review to Untagged.

## Outstanding

**Needs you**
- **Rotate the `service_role` key** — it was pasted into chat. Note this invalidates the **anon key too**, so `.env.local`, the GitHub Actions secret and a redeploy must go together.
- **Exercise the mirror**: tag one video on the new build so the table→blob mirror path gets its first real run.

**Migration backlog — 37 of 38 blobs still blobs**
- Batch 1 remaining (low risk, logs/lookups): `correction-log` 484 · `ims-truss-audit` 187 · `photo-imsmap` 45 · `dc-run-counter` 31 · `soft-holds` 23 · `notifications` 17
- Batch 2 **held deliberately** (pricing path — Deal Check, rate-card sync): `mandiCatalogue` 84 · `flowerPatterns` 40 · `trussRates` 18
- Batch 3 — ~27 small config maps. Blob is the right shape; leave them.
- Drop the `ambria-yt-tags-v1` blob after one clean release.

**Known issues not addressed**
- `saveManualVideos` still writes a whole array — same shape as the two bugs fixed today.
- Deal Check's florals aggregation doesn't walk kit `subItems`, so kit floral components are now **charged but not ordered** (pre-existing; more visible now the money is bigger).
- 13 tables carry a full-row `data` JSONB mirror alongside real columns (`event_orders.data` ~55 KB/row while `items`/`manual_items`/`decisions` sit empty). Two sources of truth per row.
- The anon key can read *and delete* the whole database, and it ships in the client bundle.
- `rebuild-library.js` guarded, not repointed at the `library` table.

**CLAUDE.md inaccuracies found**
- `boxes` is listed as a table; it does not exist (the API suggests `blocks`).
- `mandi_flowers` and `flower_patterns` are listed as tables but are **empty** — that data lives in `settings` blobs.

**Uncommitted WIP (not mine, untouched)**
IMS truck capacity (`AdminSettingsTab.jsx`, `StudioApp.jsx`, `TransportEditor.jsx`) and the Browse session banner / `resumeSavedSession` work (`StudioBrowse.jsx`, `StudioApp.jsx`).
