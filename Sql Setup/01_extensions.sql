-- Life Map v1 — Migration 01: Extensions
-- Run first, before any other migration
-- Enables pgvector (embeddings), pg_cron (scheduled jobs), pgcrypto (gen_random_uuid)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pgcrypto;