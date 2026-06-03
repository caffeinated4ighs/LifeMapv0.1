CREATE OR REPLACE FUNCTION buy_item(
  p_item_id   int,
  p_gold_cost int
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_available_gold int;
  v_item_name      text;
  v_item_active    bool;
  v_item_type      text;
BEGIN
  SELECT name, active, type
  INTO v_item_name, v_item_active, v_item_type
  FROM economy_item
  WHERE id = p_item_id;
  
  IF v_item_name IS NULL THEN
    RAISE EXCEPTION 'Item not found: %', p_item_id;
  END IF;

  IF NOT v_item_active THEN
    RAISE EXCEPTION 'Item is no longer available: %', v_item_name;
  END IF;

  SELECT available_gold INTO v_available_gold
  FROM player WHERE id = 1;

  IF v_available_gold < p_gold_cost THEN
    RAISE EXCEPTION 'Insufficient gold. Have: %, Need: %',
      v_available_gold, p_gold_cost;
  END IF;

  UPDATE player
  SET available_gold = available_gold - p_gold_cost
  WHERE id = 1;

  INSERT INTO purchase_log (economy_item_id, gold_spent)
  VALUES (p_item_id, p_gold_cost);

  INSERT INTO gold_ledger
    (source_task_id, amount, direction, arc_multiplier_applied, reason)
  VALUES
    (NULL, p_gold_cost, 'debit', 1.0, 'shop_purchase:' || v_item_name);

  -- Day off: meet mandatory immediately
  IF v_item_type = 'day_off' THEN
    UPDATE daily_state SET mandatory_met = true WHERE id = 1;
  END IF;

  -- Leisure: create a bonus task as a time blocker
  IF v_item_type = 'leisure' THEN
    INSERT INTO task (title, task_type, priority, difficulty, status, scheduled_at)
    VALUES (v_item_name, 'bonus', 'P3', 'low', 'pending', NOW());
  END IF;

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