-- Life Map — Migration 23: add stat_match_floor to app_config
-- The edge function now uses a separate, lower floor for stat matching (0.40)
-- vs skill matching (0.65). Stats benefit from broader associations.
-- Run in Supabase SQL editor.

UPDATE app_config
SET mechanics = mechanics || '{"stat_match_floor": 0.40}'::jsonb
WHERE id = 1;

-- Verify
SELECT mechanics->'stat_match_floor' AS stat_match_floor,
       mechanics->'skill_match_floor' AS skill_match_floor
FROM app_config WHERE id = 1;
