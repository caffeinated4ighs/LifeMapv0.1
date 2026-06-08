-- Life Map — Migration 24: Fix permissions for post-migration-13 tables
-- daily_snapshot (created in migration 18) and app_config (migration 22/23)
-- were created AFTER the GRANT ALL in migration 13, so they have no grants.
-- Run in Supabase SQL editor.

GRANT ALL ON TABLE daily_snapshot TO service_role, anon, authenticated;
GRANT ALL ON TABLE app_config     TO service_role, anon, authenticated;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE daily_snapshot_id_seq TO service_role, anon, authenticated;

-- Verify
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('daily_snapshot', 'app_config')
  AND grantee IN ('service_role', 'anon', 'authenticated')
ORDER BY table_name, grantee;
