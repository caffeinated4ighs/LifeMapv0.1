-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map — fn_complete_task.sql
-- Definitive version — Phase 9.2
--
-- Called by: dbAgent.js completeTask() via supabase.rpc('complete_task', {...})
--
-- Parameter list (11 params — do not change order or names):
--   p_task_id        — task to complete
--   p_xp_gained      — XP with streak multiplier already applied (app-computed)
--   p_gold_gained    — gold amount (app-computed)
--   p_streak_mult    — streak multiplier value (for ledger record)
--   p_arc_mult       — arc multiplier value (for ledger record)
--   p_new_level      — player level after XP award (app-computed, handles level-up)
--   p_new_xp         — player current_xp after award (overflow subtracted by app)
--   p_new_xp_to_next — xp_to_next for the new level (app-computed)
--   p_leveled_up     — whether a level-up occurred (for narration)
--   p_energy_drain   — energy to subtract (app-computed from task type + difficulty)
--   p_is_recovery    — if true, add 15 energy after drain
--
-- Routine tasks: the app passes flat 4 XP / 2g with p_streak_mult=1, p_arc_mult=1.
-- The function does not special-case routine — the app handles reward calculation.
--
-- IMPORTANT — column name reference (must match migration 06 exactly):
--   xp_ledger: source_task_id, amount, target_type, target_id,
--              streak_multiplier_applied, arc_multiplier_applied, crossover_type, timestamp
--   task:      no xp_gained/gold_gained/streak_mult/arc_mult columns exist.
--              Migration 20 referenced these incorrectly — this is the fix.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION complete_task(
    p_task_id        integer,
    p_xp_gained      numeric,
    p_gold_gained    numeric,
    p_streak_mult    numeric,
    p_arc_mult       numeric,
    p_new_level      integer,
    p_new_xp         numeric,
    p_new_xp_to_next numeric,
    p_leveled_up     boolean,
    p_energy_drain   integer,
    p_is_recovery    boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_task_type    text;
    v_energy_after integer;
BEGIN
    -- ── Guard: task must exist and be completable ─────────────────────────
    SELECT task_type INTO v_task_type
    FROM task WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % not found', p_task_id;
    END IF;

    IF (SELECT status FROM task WHERE id = p_task_id) = 'completed' THEN
        RAISE EXCEPTION 'Task % is already completed', p_task_id;
    END IF;

    IF (SELECT status FROM task WHERE id = p_task_id) = 'cancelled' THEN
        RAISE EXCEPTION 'Task % is cancelled', p_task_id;
    END IF;

    -- ── 1. Mark task completed ────────────────────────────────────────────
    UPDATE task
    SET status       = 'completed',
        completed_at = now()
    WHERE id = p_task_id;

    -- ── 2. Award XP and gold to player ────────────────────────────────────
    UPDATE player
    SET current_xp     = p_new_xp,
        xp_to_next     = p_new_xp_to_next,
        current_level  = p_new_level,
        total_gold     = total_gold     + p_gold_gained,
        available_gold = available_gold + p_gold_gained
    WHERE id = 1;

    -- ── 3. Write XP ledger entry (player target) ──────────────────────────
    -- Uses correct xp_ledger column names from migration 06.
    INSERT INTO xp_ledger (
        source_task_id,
        amount,
        target_type,
        target_id,
        streak_multiplier_applied,
        arc_multiplier_applied,
        timestamp
    ) VALUES (
        p_task_id,
        p_xp_gained,
        'player',
        NULL,
        p_streak_mult,
        p_arc_mult,
        now()
    );

    -- ── 4. Write gold ledger entry ────────────────────────────────────────
    INSERT INTO gold_ledger (
        source_task_id,
        amount,
        direction,
        arc_multiplier_applied,
        reason
    ) VALUES (
        p_task_id,
        p_gold_gained,
        'credit',
        p_arc_mult,
        'task_completion'
    );

    -- ── 5. Set mandatory_met if this is a mandatory task ──────────────────
    IF v_task_type = 'mandatory' THEN
        UPDATE daily_state
        SET mandatory_met = true
        WHERE id = 1;
    END IF;

    -- ── 6. Energy: drain first, then recover if recovery task ─────────────
    UPDATE energy_state
    SET current = GREATEST(0, current - p_energy_drain)
    WHERE id = 1;

    IF p_is_recovery THEN
        UPDATE energy_state
        SET current = LEAST(max, current + 15)
        WHERE id = 1;
    END IF;

    -- ── 7. Auto-grant day off if energy hits zero ─────────────────────────
    SELECT current INTO v_energy_after
    FROM energy_state WHERE id = 1;

    IF v_energy_after = 0 THEN
        UPDATE daily_state
        SET day_off_granted = true
        WHERE id = 1;
    END IF;

    -- ── 8. Return result for narration ────────────────────────────────────
    RETURN jsonb_build_object(
        'task_id',      p_task_id,
        'task_type',    v_task_type,
        'xp_gained',    p_xp_gained,
        'gold_gained',  p_gold_gained,
        'leveled_up',   p_leveled_up,
        'new_level',    p_new_level,
        'energy_after', v_energy_after
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
