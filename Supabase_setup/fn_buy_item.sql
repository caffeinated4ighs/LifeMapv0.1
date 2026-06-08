-- ═══════════════════════════════════════════════════════════════════════════
-- Life Map — fn_buy_item.sql
-- Called by: dbAgent.js buyItem() via supabase.rpc('buy_item', {...})
--
-- Atomically:
--   1. Validates item exists and is active
--   2. Checks available_gold is sufficient
--   3. Deducts from available_gold (NOT total_gold — gold ledger rule)
--   4. Writes purchase_log entry
--   5. Writes gold_ledger debit entry
--   6. If day_off: sets mandatory_met = true immediately
--   7. If leisure: creates a bonus task as a time blocker
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION buy_item(
    p_item_id   integer,
    p_gold_cost integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_available_gold integer;
    v_item_name      text;
    v_item_active    boolean;
    v_item_type      text;
BEGIN
    -- ── 1. Fetch and validate item ────────────────────────────────────────
    SELECT name, active, type
    INTO v_item_name, v_item_active, v_item_type
    FROM economy_item
    WHERE id = p_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found: %', p_item_id;
    END IF;

    IF NOT v_item_active THEN
        RAISE EXCEPTION 'Item is no longer available: %', v_item_name;
    END IF;

    -- ── 2. Check gold ─────────────────────────────────────────────────────
    SELECT available_gold INTO v_available_gold
    FROM player WHERE id = 1;

    IF v_available_gold < p_gold_cost THEN
        RAISE EXCEPTION 'Insufficient gold. Have: %, Need: %',
            v_available_gold, p_gold_cost;
    END IF;

    -- ── 3. Deduct available_gold only (total_gold never decremented) ──────
    UPDATE player
    SET available_gold = available_gold - p_gold_cost
    WHERE id = 1;

    -- ── 4. Write purchase log ─────────────────────────────────────────────
    INSERT INTO purchase_log (economy_item_id, gold_spent)
    VALUES (p_item_id, p_gold_cost);

    -- ── 5. Write gold ledger debit ────────────────────────────────────────
    INSERT INTO gold_ledger (
        source_task_id,
        amount,
        direction,
        arc_multiplier_applied,
        reason
    ) VALUES (
        NULL,
        p_gold_cost,
        'debit',
        1.0,
        'shop_purchase:' || v_item_name
    );

    -- ── 6. Day off: satisfy mandatory immediately ─────────────────────────
    IF v_item_type = 'day_off' THEN
        UPDATE daily_state SET mandatory_met = true WHERE id = 1;
    END IF;

    -- ── 7. Leisure: create a bonus task as a time blocker ─────────────────
    IF v_item_type = 'leisure' THEN
        INSERT INTO task (title, task_type, priority, difficulty, status, scheduled_at)
        VALUES (v_item_name, 'bonus', 'P3', 'low', 'pending', NOW());
    END IF;

    -- ── 8. Return result ──────────────────────────────────────────────────
    RETURN jsonb_build_object(
        'item_id',        p_item_id,
        'item_name',      v_item_name,
        'gold_spent',     p_gold_cost,
        'gold_remaining', v_available_gold - p_gold_cost
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
