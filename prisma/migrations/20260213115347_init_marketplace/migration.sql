-- DropForeignKey
ALTER TABLE "auth_identity" DROP CONSTRAINT "auth_identity_userId_fkey";

-- DropForeignKey
ALTER TABLE "chat_hub_agents" DROP CONSTRAINT "FK_441ba2caba11e077ce3fbfa2cd8";

-- DropForeignKey
ALTER TABLE "chat_hub_agents" DROP CONSTRAINT "FK_9c61ad497dcbae499c96a6a78ba";

-- DropForeignKey
ALTER TABLE "chat_hub_messages" DROP CONSTRAINT "FK_1f4998c8a7dec9e00a9ab15550e";

-- DropForeignKey
ALTER TABLE "chat_hub_messages" DROP CONSTRAINT "FK_25c9736e7f769f3a005eef4b372";

-- DropForeignKey
ALTER TABLE "chat_hub_messages" DROP CONSTRAINT "FK_6afb260449dd7a9b85355d4e0c9";

-- DropForeignKey
ALTER TABLE "chat_hub_messages" DROP CONSTRAINT "FK_acf8926098f063cdbbad8497fd1";

-- DropForeignKey
ALTER TABLE "chat_hub_messages" DROP CONSTRAINT "FK_e22538eb50a71a17954cd7e076c";

-- DropForeignKey
ALTER TABLE "chat_hub_messages" DROP CONSTRAINT "FK_e5d1fa722c5a8d38ac204746662";

-- DropForeignKey
ALTER TABLE "chat_hub_sessions" DROP CONSTRAINT "FK_7bc13b4c7e6afbfaf9be326c189";

-- DropForeignKey
ALTER TABLE "chat_hub_sessions" DROP CONSTRAINT "FK_9f9293d9f552496c40e0d1a8f80";

-- DropForeignKey
ALTER TABLE "chat_hub_sessions" DROP CONSTRAINT "FK_e9ecf8ede7d989fcd18790fe36a";

-- DropForeignKey
ALTER TABLE "data_table" DROP CONSTRAINT "FK_c2a794257dee48af7c9abf681de";

-- DropForeignKey
ALTER TABLE "data_table_column" DROP CONSTRAINT "FK_930b6e8faaf88294cef23484160";

-- DropForeignKey
ALTER TABLE "execution_annotation_tags" DROP CONSTRAINT "FK_a3697779b366e131b2bbdae2976";

-- DropForeignKey
ALTER TABLE "execution_annotation_tags" DROP CONSTRAINT "FK_c1519757391996eb06064f0e7c8";

-- DropForeignKey
ALTER TABLE "execution_annotations" DROP CONSTRAINT "FK_97f863fa83c4786f19565084960";

-- DropForeignKey
ALTER TABLE "execution_data" DROP CONSTRAINT "execution_data_fk";

-- DropForeignKey
ALTER TABLE "execution_entity" DROP CONSTRAINT "fk_execution_entity_workflow_id";

-- DropForeignKey
ALTER TABLE "execution_metadata" DROP CONSTRAINT "FK_31d0b4c93fb85ced26f6005cda3";

-- DropForeignKey
ALTER TABLE "folder" DROP CONSTRAINT "FK_804ea52f6729e3940498bd54d78";

-- DropForeignKey
ALTER TABLE "folder" DROP CONSTRAINT "FK_a8260b0b36939c6247f385b8221";

-- DropForeignKey
ALTER TABLE "folder_tag" DROP CONSTRAINT "FK_94a60854e06f2897b2e0d39edba";

-- DropForeignKey
ALTER TABLE "folder_tag" DROP CONSTRAINT "FK_dc88164176283de80af47621746";

-- DropForeignKey
ALTER TABLE "insights_by_period" DROP CONSTRAINT "FK_6414cfed98daabbfdd61a1cfbc0";

-- DropForeignKey
ALTER TABLE "insights_metadata" DROP CONSTRAINT "FK_1d8ab99d5861c9388d2dc1cf733";

-- DropForeignKey
ALTER TABLE "insights_metadata" DROP CONSTRAINT "FK_2375a1eda085adb16b24615b69c";

-- DropForeignKey
ALTER TABLE "insights_raw" DROP CONSTRAINT "FK_6e2e33741adef2a7c5d66befa4e";

-- DropForeignKey
ALTER TABLE "installed_nodes" DROP CONSTRAINT "FK_73f857fc5dce682cef8a99c11dbddbc969618951";

-- DropForeignKey
ALTER TABLE "processed_data" DROP CONSTRAINT "FK_06a69a7032c97a763c2c7599464";

-- DropForeignKey
ALTER TABLE "project_relation" DROP CONSTRAINT "FK_5f0643f6717905a05164090dde7";

-- DropForeignKey
ALTER TABLE "project_relation" DROP CONSTRAINT "FK_61448d56d61802b5dfde5cdb002";

-- DropForeignKey
ALTER TABLE "project_relation" DROP CONSTRAINT "FK_c6b99592dc96b0d836d7a21db91";

-- DropForeignKey
ALTER TABLE "role_scope" DROP CONSTRAINT "FK_role";

-- DropForeignKey
ALTER TABLE "role_scope" DROP CONSTRAINT "FK_scope";

-- DropForeignKey
ALTER TABLE "shared_credentials" DROP CONSTRAINT "FK_416f66fc846c7c442970c094ccf";

-- DropForeignKey
ALTER TABLE "shared_credentials" DROP CONSTRAINT "FK_812c2852270da1247756e77f5a4";

-- DropForeignKey
ALTER TABLE "shared_workflow" DROP CONSTRAINT "FK_a45ea5f27bcfdc21af9b4188560";

-- DropForeignKey
ALTER TABLE "shared_workflow" DROP CONSTRAINT "FK_daa206a04983d47d0a9c34649ce";

-- DropForeignKey
ALTER TABLE "test_case_execution" DROP CONSTRAINT "FK_8e4b4774db42f1e6dda3452b2af";

-- DropForeignKey
ALTER TABLE "test_case_execution" DROP CONSTRAINT "FK_e48965fac35d0f5b9e7f51d8c44";

-- DropForeignKey
ALTER TABLE "test_run" DROP CONSTRAINT "FK_d6870d3b6e4c185d33926f423c8";

-- DropForeignKey
ALTER TABLE "user" DROP CONSTRAINT "FK_eaea92ee7bfb9c1b6cd01505d56";

-- DropForeignKey
ALTER TABLE "user_api_keys" DROP CONSTRAINT "FK_e131705cbbc8fb589889b02d457";

-- DropForeignKey
ALTER TABLE "variables" DROP CONSTRAINT "FK_42f6c766f9f9d2edcc15bdd6e9b";

-- DropForeignKey
ALTER TABLE "webhook_entity" DROP CONSTRAINT "fk_webhook_entity_workflow_id";

-- DropForeignKey
ALTER TABLE "workflow_dependency" DROP CONSTRAINT "FK_a4ff2d9b9628ea988fa9e7d0bf8";

-- DropForeignKey
ALTER TABLE "workflow_entity" DROP CONSTRAINT "fk_workflow_parent_folder";

-- DropForeignKey
ALTER TABLE "workflow_history" DROP CONSTRAINT "FK_1e31657f5fe46816c34be7c1b4b";

-- DropForeignKey
ALTER TABLE "workflow_statistics" DROP CONSTRAINT "fk_workflow_statistics_workflow_id";

-- DropForeignKey
ALTER TABLE "workflows_tags" DROP CONSTRAINT "fk_workflows_tags_tag_id";

-- DropForeignKey
ALTER TABLE "workflows_tags" DROP CONSTRAINT "fk_workflows_tags_workflow_id";

-- DropTable
DROP TABLE "annotation_tag_entity";

-- DropTable
DROP TABLE "auth_identity";

-- DropTable
DROP TABLE "auth_provider_sync_history";

-- DropTable
DROP TABLE "chat_hub_agents";

-- DropTable
DROP TABLE "chat_hub_messages";

-- DropTable
DROP TABLE "chat_hub_sessions";

-- DropTable
DROP TABLE "credentials_entity";

-- DropTable
DROP TABLE "data_table";

-- DropTable
DROP TABLE "data_table_column";

-- DropTable
DROP TABLE "event_destinations";

-- DropTable
DROP TABLE "execution_annotation_tags";

-- DropTable
DROP TABLE "execution_annotations";

-- DropTable
DROP TABLE "execution_data";

-- DropTable
DROP TABLE "execution_entity";

-- DropTable
DROP TABLE "execution_metadata";

-- DropTable
DROP TABLE "folder";

-- DropTable
DROP TABLE "folder_tag";

-- DropTable
DROP TABLE "insights_by_period";

-- DropTable
DROP TABLE "insights_metadata";

-- DropTable
DROP TABLE "insights_raw";

-- DropTable
DROP TABLE "installed_nodes";

-- DropTable
DROP TABLE "installed_packages";

-- DropTable
DROP TABLE "invalid_auth_token";

-- DropTable
DROP TABLE "migrations";

-- DropTable
DROP TABLE "processed_data";

-- DropTable
DROP TABLE "project";

-- DropTable
DROP TABLE "project_relation";

-- DropTable
DROP TABLE "role";

-- DropTable
DROP TABLE "role_scope";

-- DropTable
DROP TABLE "scope";

-- DropTable
DROP TABLE "settings";

-- DropTable
DROP TABLE "shared_credentials";

-- DropTable
DROP TABLE "shared_workflow";

-- DropTable
DROP TABLE "tag_entity";

-- DropTable
DROP TABLE "test_case_execution";

-- DropTable
DROP TABLE "test_run";

-- DropTable
DROP TABLE "user";

-- DropTable
DROP TABLE "user_api_keys";

-- DropTable
DROP TABLE "variables";

-- DropTable
DROP TABLE "webhook_entity";

-- DropTable
DROP TABLE "workflow_dependency";

-- DropTable
DROP TABLE "workflow_entity";

-- DropTable
DROP TABLE "workflow_history";

-- DropTable
DROP TABLE "workflow_statistics";

-- DropTable
DROP TABLE "workflows_tags";

