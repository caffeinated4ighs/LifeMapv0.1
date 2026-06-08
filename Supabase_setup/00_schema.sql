-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map — Master Schema Setup
-- Generated: 2026-06-07 | Version: 2.0 (Phase 9.2)
--
-- Run this entire file against a fresh Supabase project to create the full
-- database schema. Function definitions are in separate files:
--   fn_regen_energy.sql
--   fn_complete_task.sql
--   fn_buy_item.sql
--
-- After running this file, run the three function files, then:
--   cd api && node embed_seed.js   ← seeds stat embedding vectors
--
-- Safe to inspect and run section by section if preferred.
-- NOT safe to re-run against a DB with existing data (use reset_db.sql first).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── EXTENSIONS ───────────────────────────────────────────────────────────────
-- pgvector: 3072-dimension embedding storage
-- pg_cron:  retained for reference; all scheduling now via GitHub Actions
-- pgcrypto: gen_random_uuid() for skill_candidate cluster IDs

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── CORE GAMEPLAY — single-row tables ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS player (
    id              int     PRIMARY KEY CHECK (id = 1),
    current_xp      int     NOT NULL DEFAULT 0,
    current_level   int     NOT NULL DEFAULT 1,
    xp_to_next      int     NOT NULL DEFAULT 100,
    total_gold      int     NOT NULL DEFAULT 0,
    available_gold  int     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS energy_state (
    id               int     PRIMARY KEY CHECK (id = 1),
    current          int     NOT NULL DEFAULT 100,
    max              int     NOT NULL DEFAULT 100,
    threshold_label  text    NOT NULL DEFAULT 'normal'
                             CHECK (threshold_label IN ('normal','reduced','min_viable','recovery')),
    last_updated     timestamp NOT NULL DEFAULT now()
);

-- daily_state carries all columns added across migrations 02, 16, and 20
CREATE TABLE IF NOT EXISTS daily_state (
    id                int     PRIMARY KEY CHECK (id = 1),
    date              date    NOT NULL DEFAULT CURRENT_DATE,
    mandatory_met     bool    NOT NULL DEFAULT false,
    day_streak        int     NOT NULL DEFAULT 0,
    streak_multiplier float   NOT NULL DEFAULT 1.0,
    morning_cron_ran  bool    NOT NULL DEFAULT false,   -- added migration 16
    eod_cron_ran      bool    NOT NULL DEFAULT false,   -- needed by cronAgent idempotency check
    day_off_granted   bool    NOT NULL DEFAULT false    -- added migration 20
);


-- ── ARCS & TASKS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arc (
    id                       serial  PRIMARY KEY,
    name                     text    NOT NULL,
    description              text,
    status                   text    NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active','inactive','completed')),
    start_date               date    NOT NULL DEFAULT CURRENT_DATE,
    end_date                 date,
    xp_multiplier            float   NOT NULL DEFAULT 1.0,
    gold_multiplier          float   NOT NULL DEFAULT 1.0,
    energy_regen_multiplier  numeric NOT NULL DEFAULT 1.0  -- added migration 20
);

-- task carries all columns added across migrations 03, 17, 20, 21
CREATE TABLE IF NOT EXISTS task (
    id                  serial      PRIMARY KEY,
    arc_id              int         REFERENCES arc(id) ON DELETE SET NULL,
    title               text        NOT NULL,
    description         text,
    task_type           text        NOT NULL
                                    CHECK (task_type IN ('mandatory','habit','project','bonus','anchor','routine')),
    priority            text        NOT NULL DEFAULT 'P2'
                                    CHECK (priority IN ('P0','P1','P2','P3')),
    difficulty          text        NOT NULL DEFAULT 'medium'
                                    CHECK (difficulty IN ('low','medium','high')),
    is_anchor           bool        NOT NULL DEFAULT false,
    is_recovery         bool        NOT NULL DEFAULT false,         -- added migration 20
    recurrence_pattern  text,
    current_streak      int,
    late_multiplier     float       NOT NULL DEFAULT 1.0,
    status              text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','active','completed','cancelled')),
    scheduled_at        timestamp,
    time_block          text        CHECK (time_block IN ('morning','noon','evening','night','midnight')),
    embedding_vector    vector(3072),
    projection_status   text        NOT NULL DEFAULT 'pending'
                                    CHECK (projection_status IN ('pending','done','failed')),
    reminded_at         timestamptz DEFAULT NULL,                   -- added migration 21
    created_at          timestamp   NOT NULL DEFAULT now(),
    completed_at        timestamp,

    CONSTRAINT task_streak_recurrence_check CHECK (
        (recurrence_pattern IS NULL AND current_streak IS NULL) OR
        (recurrence_pattern IS NOT NULL)
    )
);


-- ── STATS & SKILLS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stat (
    id               serial      PRIMARY KEY,
    name             text        NOT NULL UNIQUE,
    description      text        NOT NULL,
    current_value    float       NOT NULL DEFAULT 0,
    current_xp       float       NOT NULL DEFAULT 0,   -- used by edge function XP accumulation
    current_streak   int         NOT NULL DEFAULT 0,
    icon             text,
    embedding_vector vector(3072)
);

CREATE TABLE IF NOT EXISTS skill (
    id               serial      PRIMARY KEY,
    parent_skill_id  int         REFERENCES skill(id) ON DELETE SET NULL,
    origin_task_id   int         REFERENCES task(id) ON DELETE SET NULL,
    name             text        NOT NULL,
    description      text        NOT NULL,
    category         text        NOT NULL,
    is_dynamic       bool        NOT NULL DEFAULT false,
    current_xp       int         NOT NULL DEFAULT 0,
    current_level    int         NOT NULL DEFAULT 0,
    xp_to_next       int         NOT NULL DEFAULT 100,
    current_streak   int         NOT NULL DEFAULT 0,
    centroid_vector  vector(3072),
    created_at       timestamp   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_candidate (
    id                      serial      PRIMARY KEY,
    task_id                 int         NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    cluster_id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    distance_to_centroid    float       NOT NULL,
    cluster_centroid        vector(3072),
    status                  text        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','graduated','dismissed')),
    graduated_to_skill_id   int         REFERENCES skill(id) ON DELETE SET NULL,
    created_at              timestamp   NOT NULL DEFAULT now()
);


-- ── JOIN TABLES ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_skill (
    task_id          int   NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    skill_id         int   NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
    similarity_score float NOT NULL,
    PRIMARY KEY (task_id, skill_id)
);

CREATE TABLE IF NOT EXISTS task_stat (
    task_id          int   NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    stat_id          int   NOT NULL REFERENCES stat(id) ON DELETE CASCADE,
    similarity_score float NOT NULL,
    PRIMARY KEY (task_id, stat_id)
);


-- ── LEDGERS — append-only ────────────────────────────────────────────────────

-- xp_ledger: one row per XP award (player, skill, or stat target)
-- Column names match migration 06 exactly — do NOT change them.
-- complete_task() and post-task-completion edge fn both write here.
CREATE TABLE IF NOT EXISTS xp_ledger (
    id                          serial    PRIMARY KEY,
    source_task_id              int       NOT NULL REFERENCES task(id) ON DELETE RESTRICT,
    amount                      float     NOT NULL,
    target_type                 text      NOT NULL CHECK (target_type IN ('player','skill','stat')),
    target_id                   int,
    streak_multiplier_applied   float     NOT NULL DEFAULT 1.0,
    arc_multiplier_applied      float     NOT NULL DEFAULT 1.0,
    crossover_type              text      CHECK (crossover_type IN ('direct','partial','indirect')),
    timestamp                   timestamp NOT NULL DEFAULT now(),

    CONSTRAINT xp_ledger_target_check CHECK (
        (target_type = 'player' AND target_id IS NULL) OR
        (target_type != 'player' AND target_id IS NOT NULL)
    )
);

ALTER TABLE xp_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON xp_ledger FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON xp_ledger FOR DELETE USING (false);

CREATE TABLE IF NOT EXISTS gold_ledger (
    id                      serial    PRIMARY KEY,
    source_task_id          int       REFERENCES task(id) ON DELETE RESTRICT,
    amount                  int       NOT NULL,
    direction               text      NOT NULL CHECK (direction IN ('credit','debit')),
    arc_multiplier_applied  float     NOT NULL DEFAULT 1.0,
    reason                  text      NOT NULL,
    timestamp               timestamp NOT NULL DEFAULT now()
);

ALTER TABLE gold_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON gold_ledger FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON gold_ledger FOR DELETE USING (false);

CREATE TABLE IF NOT EXISTS decay_log (
    id              serial    PRIMARY KEY,
    target_type     text      NOT NULL CHECK (target_type IN ('skill','stat')),
    target_id       int       NOT NULL,
    decay_amount    float     NOT NULL,
    streak_at_time  int       NOT NULL,
    reason          text      NOT NULL,
    timestamp       timestamp NOT NULL DEFAULT now()
);

ALTER TABLE decay_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON decay_log FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON decay_log FOR DELETE USING (false);


-- ── ECONOMY ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS economy_item (
    id           serial  PRIMARY KEY,
    name         text    NOT NULL,
    description  text    NOT NULL,
    cost_gold    int     NOT NULL,
    type         text    NOT NULL CHECK (type IN ('leisure','day_off')),
    active       bool    NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS purchase_log (
    id                serial    PRIMARY KEY,
    economy_item_id   int       NOT NULL REFERENCES economy_item(id) ON DELETE RESTRICT,
    gold_spent        int       NOT NULL,
    purchased_at      timestamp NOT NULL DEFAULT now(),
    notes             text
);

ALTER TABLE purchase_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON purchase_log FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON purchase_log FOR DELETE USING (false);


-- ── LLM CONTEXT ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS llm_session (
    id           serial    PRIMARY KEY,
    arc_id       int       REFERENCES arc(id) ON DELETE SET NULL,
    summary      text      NOT NULL DEFAULT '',
    session_key  text      NOT NULL UNIQUE,
    updated_at   timestamp NOT NULL DEFAULT now(),
    created_at   timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_context_chunk (
    id           serial  PRIMARY KEY,
    session_id   int     NOT NULL REFERENCES llm_session(id) ON DELETE CASCADE,
    order_index  int     NOT NULL,
    content      text    NOT NULL,
    token_count  int     NOT NULL,
    role         text    NOT NULL DEFAULT 'user'
);


-- ── DAILY SNAPSHOT — for graphs ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_snapshot (
    id              serial    PRIMARY KEY,
    date            date      NOT NULL UNIQUE,
    level           int,
    current_xp      int,
    total_gold      int,
    available_gold  int,
    day_streak      int,
    energy          int,
    mandatory_met   bool,
    tasks_completed int,
    tasks_carried   int,
    created_at      timestamp NOT NULL DEFAULT now()
);


-- ── APP CONFIG — edge function mechanics ─────────────────────────────────────
-- Single-row table. Deno edge functions read mechanics constants from here
-- because they have no access to config/mechanics.json on disk.

CREATE TABLE IF NOT EXISTS app_config (
    id       int  PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mechanics jsonb NOT NULL
);

INSERT INTO app_config (id, mechanics)
SELECT 1, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE id = 1);

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


-- ── VIEW ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW active_tasks AS
    SELECT * FROM task WHERE status != 'cancelled';


-- ── INDEXES ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS skill_candidate_cluster_idx   ON skill_candidate(cluster_id);
CREATE INDEX IF NOT EXISTS llm_session_updated_idx       ON llm_session(updated_at);
CREATE INDEX IF NOT EXISTS task_projection_status_idx    ON task(projection_status) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS task_skill_skill_idx          ON task_skill(skill_id);
CREATE INDEX IF NOT EXISTS task_stat_stat_idx            ON task_stat(stat_id);
CREATE INDEX IF NOT EXISTS xp_ledger_target_idx          ON xp_ledger(target_type, target_id);
CREATE INDEX IF NOT EXISTS gold_ledger_direction_idx     ON gold_ledger(direction);
CREATE INDEX IF NOT EXISTS task_status_scheduled_idx     ON task(status, scheduled_at);
CREATE INDEX IF NOT EXISTS task_reminded_at_idx          ON task(reminded_at) WHERE status = 'pending';


-- ── PERMISSIONS ───────────────────────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO anon;

GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ── SEED DATA ─────────────────────────────────────────────────────────────────
-- Single rows for singleton tables. stat.embedding_vector intentionally NULL —
-- populated by: cd api && node embed_seed.js

INSERT INTO player (id, current_xp, current_level, xp_to_next, total_gold, available_gold)
VALUES (1, 0, 1, 100, 0, 0);

INSERT INTO energy_state (id, current, max, threshold_label)
VALUES (1, 100, 100, 'normal');

INSERT INTO daily_state (id, date, mandatory_met, day_streak, streak_multiplier, morning_cron_ran, eod_cron_ran, day_off_granted)
VALUES (1, CURRENT_DATE, false, 0, 1.0, false, false, false);

INSERT INTO stat (name, description, current_value, current_xp, current_streak) VALUES
    ('Strength',     'Physical power and endurance',             0, 0, 0),
    ('Vitality',     'Health, recovery, and resilience',         0, 0, 0),
    ('Agility',      'Speed, reflexes, and adaptability',        0, 0, 0),
    ('Dexterity',    'Precision, coordination, and skill',       0, 0, 0),
    ('Intelligence', 'Learning, reasoning, and problem solving', 0, 0, 0),
    ('Perception',   'Awareness, insight, and observation',      0, 0, 0),
    ('Charisma',     'Communication, influence, and presence',   0, 0, 0),
    ('Willpower',    'Discipline, focus, and mental strength',   0, 0, 0);


-- ═══════════════════════════════════════════════════════════════════════════
-- DONE — schema, indexes, permissions, and seed data are set.
-- Next: run fn_regen_energy.sql, fn_complete_task.sql, fn_buy_item.sql
-- Then: cd api && node embed_seed.js
-- ═══════════════════════════════════════════════════════════════════════════
