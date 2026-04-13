CREATE TABLE `baselines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`baselineEntityType` enum('campaign','ad_set') NOT NULL,
	`entityId` int NOT NULL,
	`metric` varchar(32) NOT NULL,
	`meanValue` decimal(12,6) NOT NULL,
	`stdDev` decimal(12,6) NOT NULL DEFAULT '0',
	`sampleDays` int NOT NULL DEFAULT 0,
	`computedAt` date NOT NULL,
	CONSTRAINT `baselines_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_bl_entity_metric_date` UNIQUE(`baselineEntityType`,`entityId`,`metric`,`computedAt`)
);
--> statement-breakpoint
CREATE TABLE `daily_briefs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`runId` varchar(36) NOT NULL,
	`briefDate` date NOT NULL,
	`actionOfTheDay` json NOT NULL,
	`funnelHealth` json NOT NULL,
	`topIssues` json NOT NULL,
	`kpis` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_briefs_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_db_ws_date` UNIQUE(`workspaceId`,`briefDate`)
);
--> statement-breakpoint
CREATE TABLE `daily_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`entityType` enum('campaign','ad_set') NOT NULL,
	`entityId` int NOT NULL,
	`date` date NOT NULL,
	`impressions` int NOT NULL DEFAULT 0,
	`clicks` int NOT NULL DEFAULT 0,
	`spend` decimal(12,4) NOT NULL DEFAULT '0',
	`reach` int NOT NULL DEFAULT 0,
	`frequency` decimal(6,4) NOT NULL DEFAULT '0',
	`leads` int NOT NULL DEFAULT 0,
	`ctr` decimal(8,6) NOT NULL DEFAULT '0',
	`cpc` decimal(10,4),
	`cpm` decimal(10,4),
	`cpl` decimal(10,4),
	CONSTRAINT `daily_metrics_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_dm_entity_date` UNIQUE(`entityType`,`entityId`,`date`)
);
--> statement-breakpoint
CREATE TABLE `engine_ad_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`campaignId` int NOT NULL,
	`metaAdSetId` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`engineAdSetStatus` enum('ACTIVE','PAUSED','DELETED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
	`dailyBudget` decimal(12,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `engine_ad_sets_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_eas_meta_id` UNIQUE(`metaAdSetId`)
);
--> statement-breakpoint
CREATE TABLE `engine_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`integrationId` int NOT NULL,
	`metaCampaignId` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`objective` varchar(64),
	`engineCampaignStatus` enum('ACTIVE','PAUSED','DELETED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
	`dailyBudget` decimal(12,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `engine_campaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_ec_meta_id` UNIQUE(`metaCampaignId`)
);
--> statement-breakpoint
CREATE TABLE `engine_diagnostics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`runId` varchar(36) NOT NULL,
	`ruleId` varchar(8) NOT NULL,
	`diagCategory` enum('creative','audience','funnel','tracking') NOT NULL,
	`diagEntityType` enum('campaign','ad_set') NOT NULL,
	`entityId` int NOT NULL,
	`severity` tinyint NOT NULL,
	`evidence` json NOT NULL,
	`diagStatus` enum('active','acknowledged') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `engine_diagnostics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `engine_recommendations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`runId` varchar(36) NOT NULL,
	`diagnosticId` int NOT NULL,
	`recAction` enum('PAUSE','SCALE','TEST','MONITOR','FIX_FUNNEL','FIX_SALES') NOT NULL,
	`recEntityType` enum('campaign','ad_set') NOT NULL,
	`entityId` int NOT NULL,
	`reason` varchar(512) NOT NULL,
	`evidence` json NOT NULL,
	`confidenceScore` decimal(4,3) NOT NULL,
	`priorityScore` decimal(10,2) NOT NULL,
	`expectedImpact` decimal(12,4),
	`recStatus2` enum('pending','accepted','dismissed','expired') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `engine_recommendations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`provider` varchar(32) NOT NULL DEFAULT 'meta_ads',
	`accessToken` text NOT NULL,
	`metaAccountId` varchar(64) NOT NULL,
	`accountName` varchar(255),
	`integrationStatus` enum('active','expired','error') NOT NULL DEFAULT 'active',
	`lastSyncAt` timestamp,
	`lastSyncRows` int NOT NULL DEFAULT 0,
	`lastSyncError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_integration_ws_provider` UNIQUE(`workspaceId`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`runId` varchar(36) NOT NULL,
	`pipelineStatus` enum('running','completed','failed','partial') NOT NULL DEFAULT 'running',
	`pipelineTrigger` enum('cron','manual') NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	`durationMs` int,
	`stepsCompleted` tinyint NOT NULL DEFAULT 0,
	`stepResults` json NOT NULL DEFAULT ('{}'),
	`stepErrors` json NOT NULL DEFAULT ('{}'),
	CONSTRAINT `pipeline_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_pr_run_id` UNIQUE(`runId`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`ownerId` int NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'UTC',
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_bl_ws_date` ON `baselines` (`workspaceId`,`computedAt`);--> statement-breakpoint
CREATE INDEX `idx_db_run` ON `daily_briefs` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_dm_ws_date` ON `daily_metrics` (`workspaceId`,`date`);--> statement-breakpoint
CREATE INDEX `idx_eas_campaign` ON `engine_ad_sets` (`campaignId`);--> statement-breakpoint
CREATE INDEX `idx_eas_ws_status` ON `engine_ad_sets` (`workspaceId`,`engineAdSetStatus`);--> statement-breakpoint
CREATE INDEX `idx_ec_ws_status` ON `engine_campaigns` (`workspaceId`,`engineCampaignStatus`);--> statement-breakpoint
CREATE INDEX `idx_ed_ws_active_sev` ON `engine_diagnostics` (`workspaceId`,`diagStatus`,`severity`);--> statement-breakpoint
CREATE INDEX `idx_ed_run` ON `engine_diagnostics` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_er_ws_status_priority` ON `engine_recommendations` (`workspaceId`,`recStatus2`,`priorityScore`);--> statement-breakpoint
CREATE INDEX `idx_er_diagnostic` ON `engine_recommendations` (`diagnosticId`);--> statement-breakpoint
CREATE INDEX `idx_er_run` ON `engine_recommendations` (`runId`);--> statement-breakpoint
CREATE INDEX `idx_integration_ws` ON `integrations` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_pr_ws_started` ON `pipeline_runs` (`workspaceId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_ws_owner` ON `workspaces` (`ownerId`);