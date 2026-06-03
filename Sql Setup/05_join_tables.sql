-- Life Map v1 — Migration 05: Join Tables
-- Run after 04_stats_skills.sql
-- Creates: task_skill, task_stat
-- Depends on: task, skill, stat

CREATE TABLE IF NOT EXISTS task_skill (
    task_id             int     NOT NULL    REFERENCES task(id) ON DELETE CASCADE,
    skill_id            int     NOT NULL    REFERENCES skill(id) ON DELETE CASCADE,
    similarity_score    float   NOT NULL,

    PRIMARY KEY (task_id, skill_id)
);

CREATE TABLE IF NOT EXISTS task_stat (
    task_id             int     NOT NULL    REFERENCES task(id) ON DELETE CASCADE,
    stat_id             int     NOT NULL    REFERENCES stat(id) ON DELETE CASCADE,
    similarity_score    float   NOT NULL,

    PRIMARY KEY (task_id, stat_id)
);