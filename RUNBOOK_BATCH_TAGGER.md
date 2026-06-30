# Nightly batch tagger (Part B) — deploy & schedule

Tags untagged Studio library photos automatically every night, using the same taxonomy + knowledge
base + recent corrections as the in-app tagger. Tagged photos land in the **Needs-review** pile for a
human to verify.

Project ref: `taalribntdkowoqltvqw` → function URL is
`https://taalribntdkowoqltvqw.supabase.co/functions/v1/batch-tagger`

### 1. Create the log table
Supabase → SQL editor → run `supabase/migrations/007_batch_tag_log.sql`.
(Also run `006_tag_corrections.sql` if you haven't — Part C uses it.)

### 2. Deploy the function
```
supabase functions deploy batch-tagger
```
It reuses the `ANTHROPIC_API_KEY` secret already set for the `anthropic` function; `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### 3. Test it manually first (before scheduling)
Run once with your service-role key (Supabase → Settings → API):
```
curl -X POST 'https://taalribntdkowoqltvqw.supabase.co/functions/v1/batch-tagger' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' -H 'Content-Type: application/json' -d '{}'
```
Expect a JSON reply like `{"ok":true,"tagged":N,"failed":0,"scanned":N}`. Then check:
- Supabase → `batch_tag_log` has rows.
- In the app, those photos now show **🤖 AI suggested — review**.

> It tags at most 50 photos per run (rate-limit safety). Re-run to clear a big backlog, or let the
> nightly schedule chip away at it.

### 4. Schedule it (2:00 AM IST = 20:30 UTC)
Supabase → Database → Extensions → enable **pg_cron** and **pg_net**. Then SQL editor:
```sql
select cron.schedule('nightly-tagger', '30 20 * * *', $$
  select net.http_post(
    url := 'https://taalribntdkowoqltvqw.supabase.co/functions/v1/batch-tagger',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```
Keep that SQL private — it contains the service-role key. To change/stop:
`select cron.unschedule('nightly-tagger');`

### Notes
- Runs at 2 AM when nobody's editing; it re-reads the library right before writing so a stray late-night
  edit isn't clobbered.
- It only touches photos with **no tags, not verified, not already AI-tagged** — it never re-tags or
  overwrites a verified photo.
- The in-app "🤖 Tag all untagged" button does the same thing on demand if you don't want to wait.
