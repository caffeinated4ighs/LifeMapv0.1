-- Migration 16 (fixed): handle existing 'activity' rows first

-- Step 1: Remove or reclassify any existing 'activity' items
-- Option A — delete them (if they're test data you don't need):
DELETE FROM economy_item WHERE type = 'activity';

-- Option B — reclassify them as 'leisure' (if you want to keep them):
-- UPDATE economy_item SET type = 'leisure' WHERE type = 'activity';

-- Step 2: Drop and recreate the CHECK constraint
ALTER TABLE economy_item DROP CONSTRAINT IF EXISTS economy_item_type_check;
ALTER TABLE economy_item ADD CONSTRAINT economy_item_type_check
  CHECK (type IN ('leisure', 'day_off'));

-- Step 3: Add morning_cron_ran to daily_state
ALTER TABLE daily_state
  ADD COLUMN IF NOT EXISTS morning_cron_ran bool NOT NULL DEFAULT false;