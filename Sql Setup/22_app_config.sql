-- Life Map — Migration 22: app_config table for edge function mechanics
-- Run after 21_migration.sql
-- Creates a single-row config table so Supabase edge functions (Deno, no FS access)
-- can read mechanics constants at runtime instead of using hardcoded values.

CREATE TABLE IF NOT EXISTS app_config (
  id       int  PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mechanics jsonb NOT NULL
);

INSERT INTO app_config (id, mechanics)
SELECT 1, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE id = 1);

-- Populate with current mechanics values (mirrors config/mechanics.json)
-- Re-run this UPDATE whenever mechanics.json changes.
UPDATE app_config SET mechanics = '{
  "skill_match_floor": 0.65,
  "streak_hit_threshold": 0.55,
  "skill_candidate_threshold": 3,
  "skill_candidate_max_distance": 0.40,
  "xp_base": {
    "mandatory": 10,
    "habit": 12,
    "project": 15,
    "bonus": 6,
    "anchor": 10,
    "routine": 4
  },
  "projection_tiers": [
    {"min": 0.30, "max": 0.399, "multiplier": 0.1},
    {"min": 0.40, "max": 0.499, "multiplier": 0.2},
    {"min": 0.50, "max": 0.599, "multiplier": 0.3},
    {"min": 0.60, "max": 0.699, "multiplier": 0.4},
    {"min": 0.70, "max": 0.799, "multiplier": 0.5},
    {"min": 0.80, "max": 0.899, "multiplier": 0.6},
    {"min": 0.90, "max": 0.999, "multiplier": 0.7},
    {"min": 1.00, "max": 1.001, "multiplier": 0.8}
  ]
}'::jsonb WHERE id = 1;

-- Grant access to service_role (edge functions use service key)
GRANT SELECT, UPDATE ON app_config TO service_role;
GRANT SELECT, UPDATE ON app_config TO authenticated;
GRANT SELECT ON app_config TO anon;
