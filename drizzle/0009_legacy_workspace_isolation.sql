ALTER TABLE `ad_sets` DROP INDEX `ad_sets_adSetId_unique`;--> statement-breakpoint
ALTER TABLE `ads` DROP INDEX `ads_adId_unique`;--> statement-breakpoint
ALTER TABLE `ads_accounts` DROP INDEX `ads_accounts_accountId_unique`;--> statement-breakpoint
ALTER TABLE `campaigns` DROP INDEX `campaigns_campaignId_unique`;--> statement-breakpoint
ALTER TABLE `engine_ad_sets` DROP INDEX `idx_eas_meta_id`;--> statement-breakpoint
ALTER TABLE `engine_campaigns` DROP INDEX `idx_ec_meta_id`;--> statement-breakpoint
ALTER TABLE `ad_insights` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `ad_sets` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `ads` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `ads_accounts` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `daily_summaries` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `data_connections` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `funnel_bottlenecks` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `import_jobs` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `recommendations` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `sales_activities` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `sales_agents` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `weekly_reports` ADD `workspaceId` int;--> statement-breakpoint
ALTER TABLE `ad_sets` ADD CONSTRAINT `idx_as_ws_adSetId` UNIQUE(`workspaceId`,`adSetId`);--> statement-breakpoint
ALTER TABLE `ads` ADD CONSTRAINT `idx_ad_ws_adId` UNIQUE(`workspaceId`,`adId`);--> statement-breakpoint
ALTER TABLE `ads_accounts` ADD CONSTRAINT `idx_aa_ws_accountId` UNIQUE(`workspaceId`,`accountId`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `idx_camp_ws_campaignId` UNIQUE(`workspaceId`,`campaignId`);--> statement-breakpoint
ALTER TABLE `engine_ad_sets` ADD CONSTRAINT `idx_eas_ws_meta_id` UNIQUE(`workspaceId`,`metaAdSetId`);--> statement-breakpoint
ALTER TABLE `engine_campaigns` ADD CONSTRAINT `idx_ec_ws_meta_id` UNIQUE(`workspaceId`,`metaCampaignId`);--> statement-breakpoint
CREATE INDEX `idx_ai_ws` ON `ad_insights` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_ds_ws` ON `daily_summaries` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_dc_ws` ON `data_connections` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_fb_ws` ON `funnel_bottlenecks` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_ij_ws` ON `import_jobs` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_ld_ws` ON `leads` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_rec_ws` ON `recommendations` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_sact_ws` ON `sales_activities` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_sa_ws` ON `sales_agents` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `idx_wr_ws` ON `weekly_reports` (`workspaceId`);