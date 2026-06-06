-- Migration 19: Add 'routine' to task_type ENUM + rewrite complete_task() with routine branch
-- Run against live DB before testing. Entire script is wrapped in a transaction.
-- Safe to re-run: ADD VALUE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.

BEGIN;

-- D1: Add 'routine' to task_type enum
-- Non-destructive. Cannot be rolled back (Postgres does not support removing enum values)
-- but the value is required by spec so this is intentional.
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'routine';

COMMIT;

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a multi-statement transaction
-- in older Postgres versions. The COMMIT above closes that transaction.
-- The function rewrite below runs in its own transaction.

BEGIN;

-- D2: Rewrite complete_task() with explicit routine branch
-- Routine tasks: flat 4 XP, 2 gold, no multipliers (no late, streak, arc, difficulty).
-- All non-routine task types go through the existing multiplier pipeline unchanged.
-- Function signature is identical — no callers need to change.
CREATE OR REPLACE FUNCTION complete_task(
  p_task_id        integer,
  p_xp_gained      numeric,
  p_gold_gained    numeric,
  p_streak_mult    numeric,
  p_arc_mult       numeric,
  p_new_level      integer,
  p_new_xp         numeric,
  p_new_xp_to_next numeric,
  p_leveled_up     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_task           task%ROWTYPE;
  v_task_type      text;
  v_actual_xp      numeric;
  v_actual_gold    numeric;
  v_result         jsonb;
BEGIN
  -- Fetch the task
  SELECT * INTO v_task FROM task WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found', p_task_id;
  END IF;

  IF v_task.status = 'completed' THEN
    RAISE EXCEPTION 'Task % is already completed', p_task_id;
  END IF;
  IF v_task.status = 'cancelled' THEN
    RAISE EXCEPTION 'Task % is cancelled', p_task_id;
  END IF;

  v_task_type := v_task.task_type::text;

  -- Routine branch: flat rewards, bypass all multipliers
  IF v_task_type = 'routine' THEN
    v_actual_xp   := 4;
    v_actual_gold := 2;

    -- Mark task completed
    UPDATE task
    SET status       = 'completed',
        completed_at = now()
    WHERE id = p_task_id;

    -- Award XP and gold
    UPDATE player
    SET current_xp    = current_xp + v_actual_xp,
        total_gold    = total_gold + v_actual_gold,
        available_gold = available_gold + v_actual_gold
    WHERE id = 1;

    -- Mandatory check: routine tasks do not contribute to mandatory_met
    -- (mandatory_met is set only by mandatory task_type per spec)

    v_result := jsonb_build_object(
      'task_id',    p_task_id,
      'task_type',  v_task_type,
      'xp_gained',  v_actual_xp,
      'gold_gained', v_actual_gold,
      'leveled_up', false,
      'routine',    true
    );

    RETURN v_result;
  END IF;

  -- Non-routine branch: use application-computed values
  v_actual_xp   := p_xp_gained;
  v_actual_gold := p_gold_gained;

  -- Mark task completed
  UPDATE task
  SET status       = 'completed',
      completed_at = now()
  WHERE id = p_task_id;

  -- Award XP and gold
  UPDATE player
  SET current_level  = p_new_level,
      current_xp     = p_new_xp,
      xp_to_next     = p_new_xp_to_next,
      total_gold     = total_gold + v_actual_gold,
      available_gold = available_gold + v_actual_gold
  WHERE id = 1;

  -- Set mandatory_met if this is a mandatory task
  IF v_task_type = 'mandatory' THEN
    UPDATE daily_state
    SET mandatory_met = true
    WHERE id = 1;
  END IF;

  v_result := jsonb_build_object(
    'task_id',    p_task_id,
    'task_type',  v_task_type,
    'xp_gained',  v_actual_xp,
    'gold_gained', v_actual_gold,
    'leveled_up', p_leveled_up,
    'new_level',  p_new_level,
    'routine',    false
  );

  RETURN v_result;
END;
$$;

COMMIT;
