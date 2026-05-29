-- Life Map v1 — Migration 02: Core Gameplay Tables
-- Run after 01_extensions.sql
-- Creates: player, energy_state, daily_state (all single-row tables)

CREATE TABLE IF NOT EXISTS player (
    id              int     PRIMARY KEY CHECK (id = 1),
    current_xp      int     NOT NULL    DEFAULT 0,
    current_level   int     NOT NULL    DEFAULT 1,
    xp_to_next      int     NOT NULL    DEFAULT 100,
    total_gold      int     NOT NULL    DEFAULT 0,
    available_gold  int     NOT NULL    DEFAULT 0
);

CREATE TABLE IF NOT EXISTS energy_state (
    id               int     PRIMARY KEY CHECK (id = 1),
    current          int     NOT NULL    DEFAULT 100,
    max              int     NOT NULL    DEFAULT 100,
    threshold_label  text    NOT NULL    DEFAULT 'normal'
                             CHECK (threshold_label IN ('normal','reduced','min_viable','recovery')),
    last_updated     timestamp NOT NULL  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_state (
    id                int     PRIMARY KEY CHECK (id = 1),
    date              date    NOT NULL    DEFAULT CURRENT_DATE,
    mandatory_met     bool    NOT NULL    DEFAULT false,
    day_streak        int     NOT NULL    DEFAULT 0,
    streak_multiplier float   NOT NULL    DEFAULT 1.0
);