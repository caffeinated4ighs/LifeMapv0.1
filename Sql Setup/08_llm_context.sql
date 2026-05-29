-- Life Map v1 — Migration 08: LLM Context
-- Run after 07_economy.sql
-- Creates: llm_session, llm_context_chunk
-- Depends on: arc (for llm_session.arc_id FK)

CREATE TABLE IF NOT EXISTS llm_session (
    id           serial      PRIMARY KEY,
    arc_id       int         REFERENCES arc(id) ON DELETE SET NULL,
    summary      text        NOT NULL    DEFAULT '',
    session_key  text        NOT NULL    UNIQUE,
    updated_at   timestamp   NOT NULL    DEFAULT now(),
    created_at   timestamp   NOT NULL    DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_context_chunk (
    id           serial      PRIMARY KEY,
    session_id   int         NOT NULL    REFERENCES llm_session(id) ON DELETE CASCADE,
    order_index  int         NOT NULL,
    content      text        NOT NULL,
    token_count  int         NOT NULL
);