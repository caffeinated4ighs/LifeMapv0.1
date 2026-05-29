-- Life Map v1 — Migration 11: Cron Jobs
-- Run after 10_indexes.sql
-- Depends on: pg_cron extension (01_extensions.sql), daily_state, llm_session
-- No RLS required — cron jobs are not tables
-- Note: jobs that require application logic are stubs only — full implementation
-- lives in the corresponding Supabase Edge Functions, configured in the dashboard

-- Daily EOD: roll daily_state, evaluate streak, apply streak_multiplier
SELECT cron.schedule('eod-daily-rollover', '59 23 * * *', $$
  UPDATE daily_state SET
    date = CURRENT_DATE,
    mandatory_met = false,
    day_streak = CASE WHEN mandatory_met THEN day_streak + 1 ELSE day_streak - 1 END,
    streak_multiplier = 1.0
  WHERE id = 1;
$$);

-- Daily: decay check on skills and stats with streak < -7
-- Stub only — edge function handles decay logic and writes decay_log
SELECT cron.schedule('daily-decay-check', '0 1 * * *', $$
  -- Application edge function handles decay logic and writes decay_log
  -- Cron signals edge function: select all skills/stats where current_streak < -7
$$);

-- Daily: retry failed projections (morning)
-- Stub only — edge function handles embedding pipeline retry
SELECT cron.schedule('morning-projection-retry', '0 7 * * *', $$
  -- Edge function reads: SELECT id FROM task WHERE status = 'completed' AND projection_status IN ('pending','failed')
  -- Then re-runs embedding pipeline for each
$$);

-- Weekly: TTL cleanup for llm_session (and cascades to llm_context_chunk)
SELECT cron.schedule('weekly-session-cleanup', '0 3 * * 0', $$
  DELETE FROM llm_session WHERE updated_at < NOW() - INTERVAL '7 days';
$$);