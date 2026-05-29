-- Life Map v1 — Migration 03: Tasks & Arcs
-- Run after 02_core_gameplay.sql
-- Creates: arc, task
-- Depends on: nothing upstream except extensions (vector type)

CREATE TABLE IF NOT EXISTS arc (
    id               serial  PRIMARY KEY,
    name             text    NOT NULL,
    description      text,
    status           text    NOT NULL    DEFAULT 'active'
                             CHECK (status IN ('active','inactive','completed')),
    start_date       date    NOT NULL    DEFAULT CURRENT_DATE,
    end_date         date,
    xp_multiplier    float   NOT NULL    DEFAULT 1.0,
    gold_multiplier  float   NOT NULL    DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS task (
    id                  serial      PRIMARY KEY,
    arc_id              int         REFERENCES arc(id) ON DELETE SET NULL,
    title               text        NOT NULL,
    description         text,
    task_type           text        NOT NULL
                                    CHECK (task_type IN ('mandatory','habit','project','bonus','anchor')),
    priority            text        NOT NULL    DEFAULT 'P2'
                                    CHECK (priority IN ('P0','P1','P2','P3')),
    difficulty          text        NOT NULL    DEFAULT 'medium'
                                    CHECK (difficulty IN ('low','medium','high')),
    is_anchor           bool        NOT NULL    DEFAULT false,
    recurrence_pattern  text,
    current_streak      int,
    status              text        NOT NULL    DEFAULT 'pending'
                                    CHECK (status IN ('pending','active','completed','cancelled')),
    scheduled_at        timestamp,
    time_block          text
                                    CHECK (time_block IN ('morning','noon','evening','night','midnight')),
    embedding_vector    vector(768),
    projection_status   text        NOT NULL    DEFAULT 'pending'
                                    CHECK (projection_status IN ('pending','done','failed')),
    created_at          timestamp   NOT NULL    DEFAULT now(),
    completed_at        timestamp,

    CONSTRAINT task_streak_recurrence_check CHECK (
        (recurrence_pattern IS NULL AND current_streak IS NULL) OR
        (recurrence_pattern IS NOT NULL)
    )
);