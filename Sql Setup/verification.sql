-- Life Map v1 — Verification
-- Run each of the parts one by one.

-- 1. Extensions active?
SELECT * FROM pg_extension WHERE extname IN ('vector','pg_cron','pgcrypto');

-- 2. active_tasks view working?
SELECT * FROM active_tasks;

-- 3. skill_candidate task_id constraint working?
INSERT INTO skill_candidate (task_id, cluster_id, distance_to_centroid, cluster_centroid)
VALUES (null, gen_random_uuid(), 0.1, null);
-- should fail on task_id NOT NULL

-- 4. llm_session session_key uniqueness working?
INSERT INTO llm_session (session_key, summary) VALUES ('test-key', '');
INSERT INTO llm_session (session_key, summary) VALUES ('test-key', '');
-- second insert should fail with unique violation

-- 5. xp_ledger target constraint working?
INSERT INTO xp_ledger (source_task_id, amount, target_type, target_id)
VALUES (null, 10, 'skill', null);
-- should fail: target_type='skill' requires target_id NOT NULL

-- 6. task streak constraint working?
INSERT INTO task (title, task_type) VALUES ('test', 'mandatory');
-- current_streak should default to NULL (no recurrence_pattern)

-- 7. Stat rows seeded?
SELECT name, current_value FROM stat ORDER BY id;
-- should return 8 rows, all current_value = 0

-- 8. Single-row tables have id=1?
SELECT id FROM player;
SELECT id FROM energy_state;
SELECT id FROM daily_state;
-- each should return exactly one row with id = 1