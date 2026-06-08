-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map — fn_regen_energy.sql
-- Called by: cronAgent.js runMorning() and runEod() via supabase.rpc()
--
-- Adds p_amount to energy_state.current, capped at max.
-- Safe to call multiple times — idempotent within cap.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION regen_energy(p_amount integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE energy_state
    SET current = LEAST(max, current + p_amount)
    WHERE id = 1;
END;
$$;
