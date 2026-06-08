-- Life Map — Migration 26: parent_link_floor for skill tree
-- Adds the threshold used at skill graduation to detect parent-child relationships.
-- A newly graduated skill centroid is compared to all existing skill centroids.
-- If sim >= parent_link_floor, the most similar existing skill becomes the parent.
-- Run in Supabase SQL editor.

UPDATE app_config
SET mechanics = mechanics || '{"parent_link_floor": 0.70}'::jsonb
WHERE id = 1;

-- Verify
SELECT
  mechanics->>'parent_link_floor'   AS parent_link_floor,
  mechanics->>'skill_match_floor'   AS skill_match_floor,
  mechanics->>'skill_candidate_max_distance' AS candidate_dist
FROM app_config WHERE id = 1;

-- Expected: parent_link_floor=0.70, skill_match_floor=0.65, candidate_dist=0.35
