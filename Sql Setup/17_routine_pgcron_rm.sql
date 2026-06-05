-- Life Map v1 — Migration 17: Phase 7 schema prep
-- Adds routine task type, retires pg_cron in favour of GitHub Actions

-- Step 1: Add routine to task_type CHECK constraint
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_task_type_check;
ALTER TABLE task ADD CONSTRAINT task_task_type_check
  CHECK (task_type IN ('mandatory','habit','project','bonus','anchor','routine'));

-- Step 2: Retire pg_cron jobs (GitHub Actions takes over all scheduling)
SELECT cron.unschedule('eod-daily-rollover');
SELECT cron.unschedule('daily-decay-check');
SELECT cron.unschedule('morning-projection-retry');
SELECT cron.unschedule('weekly-session-cleanup');

-- Verify all unscheduled
SELECT jobname FROM cron.job;
-- should return 0 rows