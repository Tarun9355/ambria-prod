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

### 3. Set the cron secret and test manually first (before scheduling)
Set a dedicated secret (not the service-role key) that only the cron will send:
```
supabase secrets set CRON_SECRET=<a long random value>
```
Then run once with that same value:
```
curl -X POST 'https://taalribntdkowoqltvqw.supabase.co/functions/v1/batch-tagger' \
  -H 'X-Cron-Secret: <CRON_SECRET value>' -H 'Content-Type: application/json' -d '{}'
```
Expect a JSON reply like `{"ok":true,"tagged":N,"failed":0,"scanned":N}`. Then check:
- Supabase → `batch_tag_log` has rows.
- In the app, those photos now show **🤖 AI suggested — review**.

> It tags at most 100 photos per run (rate-limit safety). Re-run to clear a big backlog, or let the
> nightly schedule chip away at it.

### 4. Schedule it (2:00 AM IST = 20:30 UTC)
Supabase → Database → Extensions → enable **pg_cron** and **pg_net**. Then SQL editor:
```sql
select cron.schedule('nightly-tagger', '30 20 * * *', $$
  select net.http_post(
    url := 'https://taalribntdkowoqltvqw.supabase.co/functions/v1/batch-tagger',
    headers := '{"X-Cron-Secret": "<CRON_SECRET value>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```
Keep that SQL private — it contains the cron secret. To change/stop:
`select cron.unschedule('nightly-tagger');`

### Notes
- Runs at 2 AM when nobody's editing; it re-reads the library right before writing so a stray late-night
  edit isn't clobbered.
- It only touches photos with **no tags, not verified, not already AI-tagged** — it never re-tags or
  overwrites a verified photo.
- The in-app "🤖 Tag all untagged" button does the same thing on demand if you don't want to wait.
