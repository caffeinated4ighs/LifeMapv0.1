-- Life Map — Migration 27: Fix skill centroid corrupted by rename
--
-- pgvector stores vectors in its own binary format, not as Postgres arrays.
-- The only way to average them in pure SQL is to use the avg() aggregate
-- that pgvector provides natively.

BEGIN;

-- ── 1. Recompute centroid using pgvector's built-in avg() ─────────────────
-- pgvector registers an avg() aggregate for the vector type directly.
-- This is the correct and only clean way to average vectors in Supabase.
UPDATE skill
SET centroid_vector = (
  SELECT avg(embedding_vector)
  FROM task
  WHERE id IN (5, 6)
    AND embedding_vector IS NOT NULL
)
WHERE id = 1;

-- ── 2. Remove bogus xp_ledger entries ─────────────────────────────────────
DELETE FROM xp_ledger
WHERE target_type = 'skill'
  AND target_id = 1
  AND source_task_id IN (4, 7);

-- ── 3. Remove bogus task_skill rows ───────────────────────────────────────
DELETE FROM task_skill
WHERE skill_id = 1
  AND task_id IN (4, 7);

-- ── 4. Recalculate skill XP from remaining ledger ─────────────────────────
UPDATE skill
SET current_xp = COALESCE((
  SELECT SUM(amount)
  FROM xp_ledger
  WHERE target_type = 'skill' AND target_id = 1
), 0)
WHERE id = 1;

-- ── 5. Fix description ────────────────────────────────────────────────────
UPDATE skill
SET description = 'Auto-generated from tasks: hackathon, leet code'
WHERE id = 1;

-- ── Verify ────────────────────────────────────────────────────────────────
SELECT
  s.id, s.name, s.current_xp, s.current_level,
  COUNT(xl.id) AS xp_ledger_entries,
  STRING_AGG(t.title, ', ' ORDER BY t.id) AS linked_tasks
FROM skill s
LEFT JOIN xp_ledger xl ON xl.target_type = 'skill' AND xl.target_id = s.id
LEFT JOIN task t ON t.id = xl.source_task_id
WHERE s.id = 1
GROUP BY s.id, s.name, s.current_xp, s.current_level;

COMMIT;
