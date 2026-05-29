-- Life Map v1 — Migration 10: Indexes
-- Run after 09_view.sql
-- Depends on: task, skill_candidate, llm_session, task_skill, task_stat, xp_ledger, gold_ledger
-- No RLS required — indexes are not tables

CREATE INDEX IF NOT EXISTS skill_candidate_cluster_idx     ON skill_candidate(cluster_id);
CREATE INDEX IF NOT EXISTS llm_session_updated_idx         ON llm_session(updated_at);
CREATE INDEX IF NOT EXISTS task_projection_status_idx      ON task(projection_status) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS task_skill_skill_idx            ON task_skill(skill_id);
CREATE INDEX IF NOT EXISTS task_stat_stat_idx              ON task_stat(stat_id);
CREATE INDEX IF NOT EXISTS xp_ledger_target_idx            ON xp_ledger(target_type, target_id);
CREATE INDEX IF NOT EXISTS gold_ledger_direction_idx       ON gold_ledger(direction);