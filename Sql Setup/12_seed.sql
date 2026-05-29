-- Life Map v1 — Migration 12: Seed Data
-- Run after 11_cron.sql — final migration
-- Inserts: player, energy_state, daily_state (single rows), stat (8 rows)
-- Note: skill seeds are a Phase 3 concern — do not seed here
-- Note: stat.embedding_vector intentionally NULL — populated later by embed_seed.js in Phase 3
-- No RLS required

-- Player (single row)
INSERT INTO player (id, current_xp, current_level, xp_to_next, total_gold, available_gold)
VALUES (1, 0, 1, 100, 0, 0);

-- Energy state (single row)
INSERT INTO energy_state (id, current, max, threshold_label)
VALUES (1, 100, 100, 'normal');

-- Daily state (single row)
INSERT INTO daily_state (id, date, mandatory_met, day_streak, streak_multiplier)
VALUES (1, CURRENT_DATE, false, 0, 1.0);

-- Stats (8 rows — embedding_vector NULL, seeded later by embed_seed.js in Phase 3)
INSERT INTO stat (name, description, current_value, current_streak) VALUES
  ('Strength',     'Physical power and endurance',             0, 0),
  ('Vitality',     'Health, recovery, and resilience',         0, 0),
  ('Agility',      'Speed, reflexes, and adaptability',        0, 0),
  ('Dexterity',    'Precision, coordination, and skill',       0, 0),
  ('Intelligence', 'Learning, reasoning, and problem solving', 0, 0),
  ('Perception',   'Awareness, insight, and observation',      0, 0),
  ('Charisma',     'Communication, influence, and presence',   0, 0),
  ('Willpower',    'Discipline, focus, and mental strength',   0, 0);