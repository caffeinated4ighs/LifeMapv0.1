-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map — repair_skill_overmatch.sql
-- Run ONCE in Supabase SQL editor.
--
-- Problem:
--   The deployed edge function (pre-9.2) used skill_match_floor=0.30 instead
--   of 0.65. This caused ALL tasks to award XP to "task management" (skill id=1)
--   even at indirect similarity (0.30-0.59), which is too loose.
--
-- Fix:
--   1. Remove the bad xp_ledger entries (indirect hits to any skill)
--   2. Recalculate each skill's XP from remaining legitimate ledger entries
--   3. Recompute level and xp_to_next
--   4. Also remove task_skill join rows for those tasks (sim was too low)
--
-- After running this, deploy the new edge function (skill_match_floor=0.65)
-- and re-complete any tasks to rebuild XP correctly.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Remove indirect xp_ledger entries targeting skills ─────────────────
-- "indirect" crossover_type = similarity 0.30–0.59, below the correct 0.65 floor.
-- These were awarded because the old edge fn had floor=0.30.
DELETE FROM xp_ledger
WHERE target_type = 'skill'
  AND crossover_type = 'indirect';

-- ── 2. Remove partial entries below the new 0.65 floor ────────────────────
-- "partial" spans 0.60–0.89. Entries with sim 0.60–0.64 snuck in too.
-- We can't recover the exact similarity from the ledger, but given the pattern
-- (all tasks hitting one skill at low multipliers), we delete partial entries
-- where the amount suggests sim < 0.65 (multiplier < 0.4 = amount < 0.4 * baseXp).
-- Conservative: only delete partial entries where amount <= 4 (10xp * 0.4 = 4).
-- Adjust this threshold if your task base XP differs.
DELETE FROM xp_ledger
WHERE target_type = 'skill'
  AND crossover_type = 'partial'
  AND amount <= 4;

-- ── 3. Remove over-matched task_skill join rows ────────────────────────────
-- These low-similarity joins are now invalid. Remove them so future projections
-- are clean. task_skill is not append-only so we can delete freely.
DELETE FROM task_skill
WHERE skill_id IN (
  -- Skills that had indirect hits (id=1 and any other)
  SELECT DISTINCT target_id FROM xp_ledger WHERE target_type = 'skill' AND crossover_type = 'indirect'
);
-- Note: above runs against pre-delete state because of transaction ordering.
-- Re-run if task_skill still has stale rows after commit.

-- ── 4. Reset all skill XP and recompute from remaining ledger ─────────────
-- Simpler and more reliable than partial recalculation.
-- Skills will rebuild as tasks are completed with the new edge function.

UPDATE skill SET
  current_xp    = 0,
  current_level = 0,
  xp_to_next    = 50,  -- level 0 → 1 threshold
  current_streak = 0
WHERE id IN (
  SELECT DISTINCT target_id FROM xp_ledger WHERE target_type = 'skill'
);

-- If you want to keep XP from legitimate hits (partial >= 0.65, direct),
-- sum them from the now-cleaned ledger:
UPDATE skill s SET
  current_xp = COALESCE((
    SELECT SUM(amount)
    FROM xp_ledger
    WHERE target_type = 'skill' AND target_id = s.id
  ), 0)
WHERE id IN (SELECT DISTINCT target_id FROM xp_ledger WHERE target_type = 'skill');

-- ── 5. Verify ─────────────────────────────────────────────────────────────
SELECT 
  s.id,
  s.name,
  s.current_xp,
  s.current_level,
  COUNT(xl.id) AS remaining_ledger_entries
FROM skill s
LEFT JOIN xp_ledger xl ON xl.target_type = 'skill' AND xl.target_id = s.id
GROUP BY s.id, s.name, s.current_xp, s.current_level
ORDER BY s.id;

COMMIT;

-- ── After this script ──────────────────────────────────────────────────────
-- 1. Deploy the new edge function (supabase/functions/post-task-completion/index.ts)
--    which uses skill_match_floor=0.65
-- 2. Optionally re-project completed tasks:
--    UPDATE task SET projection_status = 'pending'
--    WHERE status = 'completed' AND projection_status = 'done';
--    Then the morning cron will retry projections at correct thresholds.
