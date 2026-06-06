-- Migration 20: Energy System
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE throughout)
-- Apply against live DB before restarting server.

BEGIN;

-- ── 1. task: add is_recovery ─────────────────────────────────────────────────
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS is_recovery boolean NOT NULL DEFAULT false;

-- ── 2. daily_state: add day_off_granted ──────────────────────────────────────
ALTER TABLE daily_state
  ADD COLUMN IF NOT EXISTS day_off_granted boolean NOT NULL DEFAULT false;

-- ── 3. arc: add energy_regen_multiplier ──────────────────────────────────────
ALTER TABLE arc
  ADD COLUMN IF NOT EXISTS energy_regen_multiplier numeric NOT NULL DEFAULT 1.0;

-- ── 4. regen_energy() — called by cron morning regen and EOD recovery scan ───
CREATE OR REPLACE FUNCTION regen_energy(p_amount integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE energy_state
  SET current = LEAST(max, current + p_amount)
  WHERE id = 1;
END;
$$;

-- ── 5. complete_task() — add energy drain + recovery + day-off check ─────────
-- NOTE: Replace the full function body below.
-- The existing parameters (p_task_id … p_leveled_up) are unchanged;
-- two new parameters are appended at the end.
CREATE OR REPLACE FUNCTION complete_task(
  p_task_id        integer,
  p_xp_gained      numeric,
  p_gold_gained     numeric,
  p_streak_mult    numeric,
  p_arc_mult       numeric,
  p_new_level      integer,
  p_new_xp         numeric,
  p_new_xp_to_next numeric,
  p_leveled_up     boolean,
  p_energy_drain   integer,
  p_is_recovery    boolean
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_energy_after integer;
BEGIN
  -- Mark task completed
  UPDATE task
  SET
    status       = 'completed',
    completed_at = now(),
    xp_gained    = p_xp_gained,
    gold_gained  = p_gold_gained,
    streak_mult  = p_streak_mult,
    arc_mult     = p_arc_mult
  WHERE id = p_task_id;

  -- Award XP and gold to player
  UPDATE player
  SET
    current_xp    = p_new_xp,
    xp_to_next    = p_new_xp_to_next,
    current_level = p_new_level,
    total_gold    = total_gold    + p_gold_gained,
    available_gold = available_gold + p_gold_gained
  WHERE id = 1;

  -- Write XP ledger entry
  INSERT INTO xp_ledger (task_id, xp_gained, gold_gained, streak_mult, arc_mult, timestamp)
  VALUES (p_task_id, p_xp_gained, p_gold_gained, p_streak_mult, p_arc_mult, now());

  -- Update mandatory_met if task is mandatory
  UPDATE daily_state
  SET mandatory_met = true
  WHERE id = 1
    AND EXISTS (
      SELECT 1 FROM task WHERE id = p_task_id AND task_type = 'mandatory'
    );

  -- Energy: drain first
  UPDATE energy_state
  SET current = GREATEST(0, current - p_energy_drain)
  WHERE id = 1;

  -- If recovery task, restore energy
  IF p_is_recovery THEN
    UPDATE energy_state
    SET current = LEAST(max, current + 15)
    WHERE id = 1;
  END IF;

  -- Check day off threshold
  IF (SELECT current FROM energy_state WHERE id = 1) = 0 THEN
    UPDATE daily_state SET day_off_granted = true WHERE id = 1;
  END IF;

  SELECT current INTO v_energy_after FROM energy_state WHERE id = 1;

  RETURN jsonb_build_object(
    'task_id',      p_task_id,
    'xp_gained',    p_xp_gained,
    'gold_gained',  p_gold_gained,
    'leveled_up',   p_leveled_up,
    'new_level',    p_new_level,
    'energy_after', v_energy_after
  );
END;
$$;

COMMIT;
