-- Migration: Drop unused n8n and unrelated tables
-- These tables are from n8n workflow automation system and are not used by CTO Marketplace
-- Run this script manually in PostgreSQL to clean up the database

-- Drop n8n workflow-related tables (in dependency order)
DROP TABLE IF EXISTS "workflows_tags" CASCADE;
DROP TABLE IF EXISTS "workflow_statistics" CASCADE;
DROP TABLE IF EXISTS "workflow_history" CASCADE;
DROP TABLE IF EXISTS "workflow_dependency" CASCADE;
DROP TABLE IF EXISTS "workflow_entity" CASCADE;
DROP TABLE IF EXISTS "webhook_entity" CASCADE;
DROP TABLE IF EXISTS "variables" CASCADE;
DROP TABLE IF EXISTS "user_api_keys" CASCADE;
DROP TABLE IF EXISTS "test_case_execution" CASCADE;
DROP TABLE IF EXISTS "test_run" CASCADE;
DROP TABLE IF EXISTS "tag_entity" CASCADE;
DROP TABLE IF EXISTS "shared_workflow" CASCADE;
DROP TABLE IF EXISTS "shared_credentials" CASCADE;
DROP TABLE IF EXISTS "settings" CASCADE;
DROP TABLE IF EXISTS "scope" CASCADE;
DROP TABLE IF EXISTS "role_scope" CASCADE;
DROP TABLE IF EXISTS "role" CASCADE;
DROP TABLE IF EXISTS "project_relation" CASCADE;
DROP TABLE IF EXISTS "project" CASCADE;
DROP TABLE IF EXISTS "processed_data" CASCADE;
DROP TABLE IF EXISTS "oauth_user_consents" CASCADE;
DROP TABLE IF EXISTS "oauth_refresh_tokens" CASCADE;
DROP TABLE IF EXISTS "oauth_clients" CASCADE;
DROP TABLE IF EXISTS "oauth_authorization_codes" CASCADE;
DROP TABLE IF EXISTS "oauth_access_tokens" CASCADE;
DROP TABLE IF EXISTS "migrations" CASCADE;
DROP TABLE IF EXISTS "invalid_auth_token" CASCADE;
DROP TABLE IF EXISTS "installed_packages" CASCADE;
DROP TABLE IF EXISTS "installed_nodes" CASCADE;
DROP TABLE IF EXISTS "insights_raw" CASCADE;
DROP TABLE IF EXISTS "insights_metadata" CASCADE;
DROP TABLE IF EXISTS "insights_by_period" CASCADE;
DROP TABLE IF EXISTS "execution_annotations" CASCADE;
DROP TABLE IF EXISTS "execution_annotation_tags" CASCADE;
DROP TABLE IF EXISTS "execution_data" CASCADE;
DROP TABLE IF EXISTS "execution_entity" CASCADE;
DROP TABLE IF EXISTS "execution_metadata" CASCADE;
DROP TABLE IF EXISTS "event_destinations" CASCADE;
DROP TABLE IF EXISTS "data_table_column" CASCADE;
DROP TABLE IF EXISTS "data_table" CASCADE;
DROP TABLE IF EXISTS "credentials_entity" CASCADE;
DROP TABLE IF EXISTS "binary_data" CASCADE;
DROP TABLE IF EXISTS "auth_provider_sync_history" CASCADE;
DROP TABLE IF EXISTS "auth_identity" CASCADE;
DROP TABLE IF EXISTS "annotation_tag_entity" CASCADE;

-- Drop n8n chat hub tables
DROP TABLE IF EXISTS "chat_hub_messages" CASCADE;
DROP TABLE IF EXISTS "chat_hub_agents" CASCADE;
DROP TABLE IF EXISTS "chat_hub_sessions" CASCADE;

-- Drop unrelated tables that are not part of CTO Marketplace
-- Note: These might be from other services or legacy code
DROP TABLE IF EXISTS "vetting_results" CASCADE;
DROP TABLE IF EXISTS "lp_data" CASCADE;
DROP TABLE IF EXISTS "launch_analysis" CASCADE;
DROP TABLE IF EXISTS "holders" CASCADE;
DROP TABLE IF EXISTS "folder_tag" CASCADE;
DROP TABLE IF EXISTS "folder" CASCADE;

-- Note: The following tables are KEPT (CTO Marketplace core tables):
-- - User (user accounts)
-- - Listing (token listings)
-- - ScanResult (scan results)
-- - Payment (payment tracking)
-- - Meme (uploaded memes)
-- - Wallet (user wallets)
-- - UserListing (user-created listings)
-- - AdBoost (ad boost tracking)
-- - Waitlist (waitlist emails)
-- - _prisma_migrations (Prisma migration tracking)

-- Also note: There's a lowercase "user" table (from n8n) vs uppercase "User" table (from CTO)
-- The lowercase "user" table is from n8n and should be dropped if it exists
DROP TABLE IF EXISTS "user" CASCADE;

-- Drop "tokens" table - this was from n8n testing/workflows
-- The backend now uses "Listing" table exclusively
-- Any tokens in this table will be re-discovered by the backend's token discovery system
DROP TABLE IF EXISTS "tokens" CASCADE;

