-- Life Map v1 — Migration 14: complete_task transaction function
-- Run after 13_Permissions.sql
-- Creates a Postgres function that atomically completes a task and
-- updates all downstream state in a single transaction

CREATE OR REPLACE FUNCTION complete_task(
  p_task_id         int,
  p_xp_gained       float,
  p_gold_gained     int,
  p_streak_mult     float,
  p_arc_mult        float,
  p_new_level       int,
  p_new_xp          int,
  p_new_xp_to_next  int,
  p_leveled_up      bool
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_arc_id int;
  v_arc_gold_mult float := 1.0;
  v_arc_xp_mult float := 1.0;
  v_final_xp float;
  v_final_gold int;
BEGIN
  -- Get arc multipliers if task is linked to an arc
  SELECT arc_id INTO v_arc_id FROM task WHERE id = p_task_id;

  IF v_arc_id IS NOT NULL THEN
    SELECT xp_multiplier, gold_multiplier
    INTO v_arc_xp_mult, v_arc_gold_mult
    FROM arc WHERE id = v_arc_id AND status = 'active';
  END IF;

  v_final_xp := p_xp_gained * v_arc_xp_mult;
  v_final_gold := FLOOR(p_gold_gained * v_arc_gold_mult);

  -- 1. Mark task complete
  UPDATE task
  SET status = 'completed', completed_at = now()
  WHERE id = p_task_id;

  -- 2. Update player XP, gold, level
  UPDATE player SET
    current_xp    = p_new_xp,
    current_level = p_new_level,
    xp_to_next    = p_new_xp_to_next,
    total_gold    = total_gold + v_final_gold,
    available_gold = available_gold + v_final_gold
  WHERE id = 1;

  -- 3. Write XP ledger entry (player target)
  INSERT INTO xp_ledger
    (source_task_id, amount, target_type, target_id,
     streak_multiplier_applied, arc_multiplier_applied)
  VALUES
    (p_task_id, v_final_xp, 'player', NULL,
     p_streak_mult, p_arc_mult);

  -- 4. Write gold ledger entry
  INSERT INTO gold_ledger
    (source_task_id, amount, direction, arc_multiplier_applied, reason)
  VALUES
    (p_task_id, v_final_gold, 'credit', v_arc_gold_mult,
     'task_completion');

  -- 5. Update mandatory_met if task_type is mandatory
  UPDATE daily_state SET mandatory_met = true
  WHERE id = 1
    AND (SELECT task_type FROM task WHERE id = p_task_id) = 'mandatory';

  -- Return result for narration
  RETURN jsonb_build_object(
    'task_id',     p_task_id,
    'xp_gained',   v_final_xp,
    'gold_gained',  v_final_gold,
    'leveled_up',  p_leveled_up,
    'new_level',   p_new_level,
    'arc_applied', v_arc_id IS NOT NULL
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;