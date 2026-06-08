-- Life Map — reset_db.sql
-- ⚠️  DESTRUCTIVE: drops ALL Life Map tables and data.
-- Use only in development. Never run against production.
--
-- After running this, re-run all migrations in Sql Setup/ in order (01 → 22),
-- then run: cd api && node embed_seed.js

-- Disable triggers temporarily to avoid FK constraint errors during drop
SET session_replication_role = 'replica';

-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS app_config          CASCADE;
DROP TABLE IF EXISTS daily_snapshot      CASCADE;
DROP TABLE IF EXISTS purchase_log        CASCADE;
DROP TABLE IF EXISTS economy_item        CASCADE;
DROP TABLE IF EXISTS decay_log           CASCADE;
DROP TABLE IF EXISTS gold_ledger         CASCADE;
DROP TABLE IF EXISTS xp_ledger           CASCADE;
DROP TABLE IF EXISTS task_stat           CASCADE;
DROP TABLE IF EXISTS task_skill          CASCADE;
DROP TABLE IF EXISTS skill_candidate     CASCADE;
DROP TABLE IF EXISTS skill               CASCADE;
DROP TABLE IF EXISTS stat                CASCADE;
DROP TABLE IF EXISTS llm_context_chunk   CASCADE;
DROP TABLE IF EXISTS llm_session         CASCADE;
DROP TABLE IF EXISTS task                CASCADE;
DROP TABLE IF EXISTS arc                 CASCADE;
DROP TABLE IF EXISTS daily_state         CASCADE;
DROP TABLE IF EXISTS energy_state        CASCADE;
DROP TABLE IF EXISTS player              CASCADE;

-- Drop views
DROP VIEW IF EXISTS active_tasks;

-- Drop functions
DROP FUNCTION IF EXISTS complete_task CASCADE;
DROP FUNCTION IF EXISTS buy_item CASCADE;
DROP FUNCTION IF EXISTS regen_energy CASCADE;

-- Drop types (if using ENUM — routine task_type was added via ALTER TYPE)
-- Note: task_type may be a CHECK constraint rather than a true ENUM.
-- Safe to attempt drop; will no-op if not found.
DROP TYPE IF EXISTS task_type CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- Unschedule any lingering pg_cron jobs (may not exist)
DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job;
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron not installed or no jobs
END;
$$;

-- Drop extensions (optional — comment out if other projects use them)
-- DROP EXTENSION IF EXISTS vector;
-- DROP EXTENSION IF EXISTS pg_cron;
-- DROP EXTENSION IF EXISTS pgcrypto;

-- Confirmation
SELECT 'reset_db.sql complete — all Life Map tables dropped. Re-run migrations 01–22 next.' AS status;
