-- Life Map v1 — Migration 07: Economy
-- Run after 06_ledgers.sql
-- Creates: economy_item, purchase_log
-- Depends on: nothing upstream (purchase_log references economy_item only)
-- Note: purchase_log is append-only — RLS blocks UPDATE and DELETE

CREATE TABLE IF NOT EXISTS economy_item (
    id           serial  PRIMARY KEY,
    name         text    NOT NULL,
    description  text    NOT NULL,
    cost_gold    int     NOT NULL,
    type         text    NOT NULL    CHECK (type IN ('leisure','day_off')),
    active       bool    NOT NULL    DEFAULT true
);

CREATE TABLE IF NOT EXISTS purchase_log (
    id                serial      PRIMARY KEY,
    economy_item_id   int         NOT NULL    REFERENCES economy_item(id) ON DELETE RESTRICT,
    gold_spent        int         NOT NULL,
    purchased_at      timestamp   NOT NULL    DEFAULT now(),
    notes             text
);

ALTER TABLE purchase_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_update" ON purchase_log FOR UPDATE USING (false);
CREATE POLICY "no_delete" ON purchase_log FOR DELETE USING (false);