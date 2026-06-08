-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map — Migration 25: Tighten skill clustering thresholds
-- Run in Supabase SQL editor AFTER repair_skill_overmatch.sql
--
-- Changes:
--   skill_match_floor:            0.30 → 0.65  (already set, confirm)
--   stat_match_floor:             0.40          (already set, confirm)
--   skill_candidate_max_distance: 0.40 → 0.35  (tighter pre-graduation clustering)
--     distance 0.35 = similarity >= 0.65 needed to join a cluster
--     This ensures clusters form from genuinely similar tasks only
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE app_config
SET mechanics = mechanics
  || '{"skill_match_floor": 0.65}'::jsonb
  || '{"stat_match_floor": 0.40}'::jsonb
  || '{"skill_candidate_max_distance": 0.35}'::jsonb
WHERE id = 1;

-- Verify all thresholds
SELECT
  mechanics->>'skill_match_floor'            AS skill_match_floor,
  mechanics->>'stat_match_floor'             AS stat_match_floor,
  mechanics->>'skill_candidate_max_distance' AS candidate_max_distance,
  mechanics->>'skill_candidate_threshold'    AS candidate_threshold
FROM app_config WHERE id = 1;

-- Expected:
--  skill_match_floor   | 0.65
--  stat_match_floor    | 0.40
--  candidate_max_dist  | 0.35
--  candidate_threshold | 3

-- ── Optional: mark completed tasks for re-projection ──────────────────────
-- Uncomment to re-run the embedding pipeline on all completed tasks
-- with the new thresholds after deploying the new edge function.
-- WARNING: this will call the embedding API for every completed task —
-- cost is ~1 API call per task. Only run if you have few completed tasks.

-- UPDATE task
-- SET projection_status = 'pending'
-- WHERE status = 'completed'
--   AND projection_status = 'done';
