-- Life Map v1 — Migration 09: Views
-- Run after 08_llm_context.sql
-- Depends on: task

CREATE OR REPLACE VIEW active_tasks AS
  SELECT * FROM task
  WHERE status != 'cancelled';