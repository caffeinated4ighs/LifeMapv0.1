-- Life Map v1 — Migration 04: Stats & Skills
-- Run after 03_tasks_arcs.sql
-- Creates: stat, skill, skill_candidate
-- Depends on: task (for skill.origin_task_id and skill_candidate.task_id FKs)

CREATE TABLE IF NOT EXISTS stat (
    id               serial      PRIMARY KEY,
    name             text        NOT NULL    UNIQUE,
    description      text        NOT NULL,
    current_value    float       NOT NULL    DEFAULT 0,
    current_streak   int         NOT NULL    DEFAULT 0,
    icon             text,
    embedding_vector vector(768)
);

CREATE TABLE IF NOT EXISTS skill (
    id               serial      PRIMARY KEY,
    parent_skill_id  int         REFERENCES skill(id) ON DELETE SET NULL,
    origin_task_id   int         REFERENCES task(id) ON DELETE SET NULL,
    name             text        NOT NULL,
    description      text        NOT NULL,
    category         text        NOT NULL,
    is_dynamic       bool        NOT NULL    DEFAULT false,
    current_xp       int         NOT NULL    DEFAULT 0,
    current_level    int         NOT NULL    DEFAULT 0,
    xp_to_next       int         NOT NULL    DEFAULT 100,
    current_streak   int         NOT NULL    DEFAULT 0,
    centroid_vector  vector(768),
    created_at       timestamp   NOT NULL    DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_candidate (
    id                      serial      PRIMARY KEY,
    task_id                 int         NOT NULL    REFERENCES task(id) ON DELETE CASCADE,
    cluster_id              uuid        NOT NULL    DEFAULT gen_random_uuid(),
    distance_to_centroid    float       NOT NULL,
    cluster_centroid        vector(768),
    status                  text        NOT NULL    DEFAULT 'pending'
                                        CHECK (status IN ('pending','graduated','dismissed')),
    graduated_to_skill_id   int         REFERENCES skill(id) ON DELETE SET NULL,
    created_at              timestamp   NOT NULL    DEFAULT now()
);