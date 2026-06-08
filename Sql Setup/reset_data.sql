-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map — reset_data.sql
-- Wipes ALL game data and resets to day-one state.
-- Structure (tables, indexes, functions) is PRESERVED.
-- Safe to run repeatedly. Use in dev whenever you want a clean slate.
--
-- Run order: paste entire file into Supabase SQL editor and execute.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Truncate all data tables in dependency order ───────────────────────
-- CASCADE handles FK children automatically within each TRUNCATE.

TRUNCATE TABLE
    xp_ledger,
    gold_ledger,
    decay_log
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    purchase_log
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    task_skill,
    task_stat
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    skill_candidate
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    skill
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    llm_context_chunk,
    llm_session
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    daily_snapshot
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    task
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    arc
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    economy_item
RESTART IDENTITY CASCADE;

-- ── 2. Reset single-row game state tables ─────────────────────────────────

UPDATE player SET
    current_xp     = 0,
    current_level  = 1,
    xp_to_next     = 100,
    total_gold     = 0,
    available_gold = 0
WHERE id = 1;

UPDATE energy_state SET
    current          = 100,
    max              = 100,
    threshold_label  = 'normal',
    last_updated     = now()
WHERE id = 1;

UPDATE daily_state SET
    date              = CURRENT_DATE,
    mandatory_met     = false,
    day_streak        = 0,
    streak_multiplier = 1.0,
    morning_cron_ran  = false,
    eod_cron_ran      = false,
    day_off_granted   = false
WHERE id = 1;

-- ── 3. Reset stat scores and streaks (keep rows and embedding vectors) ────
-- Embeddings are expensive to regenerate — we keep them.
-- current_value is the stat score; reset to 0 but embeddings stay.

UPDATE stat SET
    current_value  = 0,
    current_streak = 0;

-- ── 4. Verify ─────────────────────────────────────────────────────────────

SELECT 'player'       AS table_name, count(*) AS rows FROM player
UNION ALL
SELECT 'task',         count(*) FROM task
UNION ALL
SELECT 'skill',        count(*) FROM skill
UNION ALL
SELECT 'stat',         count(*) FROM stat
UNION ALL
SELECT 'xp_ledger',    count(*) FROM xp_ledger
UNION ALL
SELECT 'gold_ledger',  count(*) FROM gold_ledger
UNION ALL
SELECT 'llm_session',  count(*) FROM llm_session
ORDER BY table_name;

COMMIT;

-- Expected output:
--  player      | 1   (reset to Lv1, 0 XP, 0 gold)
--  task        | 0
--  skill       | 0
--  stat        | 8   (embeddings preserved)
--  xp_ledger   | 0
--  gold_ledger | 0
--  llm_session | 0
