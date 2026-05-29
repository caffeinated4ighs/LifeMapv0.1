-- Life Map v1 — Migration 06: Ledgers
-- Run after 05_join_tables.sql
-- Creates: xp_ledger, gold_ledger, decay_log
-- Depends on: task, skill, stat
-- Note: all three tables are append-only — RLS blocks UPDATE and DELETE

CREATE TABLE IF NOT EXISTS xp_ledger (
    id                          serial      PRIMARY KEY,
    source_task_id              int         NOT NULL    REFERENCES task(id) ON DELETE RESTRICT,
    amount                      float       NOT NULL,
    target_type                 text        NOT NULL
                                            CHECK (target_type IN ('player','skill','stat')),
    target_id                   int,
    streak_multiplier_applied   float       NOT NULL    DEFAULT 1.0,
    arc_multiplier_applied      float       NOT NULL    DEFAULT 1.0,
    crossover_type              text
                                            CHECK (crossover_type IN ('direct','partial','indirect')),
    timestamp                   timestamp   NOT NULL    DEFAULT now(),

    CONSTRAINT xp_ledger_target_check CHECK (
        (target_type = 'player' AND target_id IS NULL) OR
        (target_type != 'player' AND target_id IS NOT NULL)
    )
);

ALTER TABLE xp_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON xp_ledger FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON xp_ledger FOR DELETE USING (false);

---

CREATE TABLE IF NOT EXISTS gold_ledger (
    id                      serial      PRIMARY KEY,
    source_task_id          int         REFERENCES task(id) ON DELETE RESTRICT,
    amount                  int         NOT NULL,
    direction               text        NOT NULL
                                        CHECK (direction IN ('credit','debit')),
    arc_multiplier_applied  float       NOT NULL    DEFAULT 1.0,
    reason                  text        NOT NULL,
    timestamp               timestamp   NOT NULL    DEFAULT now()
);

ALTER TABLE gold_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON gold_ledger FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON gold_ledger FOR DELETE USING (false);

---

CREATE TABLE IF NOT EXISTS decay_log (
    id              serial      PRIMARY KEY,
    target_type     text        NOT NULL    CHECK (target_type IN ('skill','stat')),
    target_id       int         NOT NULL,
    decay_amount    float       NOT NULL,
    streak_at_time  int         NOT NULL,
    reason          text        NOT NULL,
    timestamp       timestamp   NOT NULL    DEFAULT now()
);

ALTER TABLE decay_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON decay_log FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON decay_log FOR DELETE USING (false);