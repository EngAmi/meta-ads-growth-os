ALTER TABLE `integrations` DROP INDEX `idx_integration_ws_provider`;--> statement-breakpoint
ALTER TABLE `integrations` ADD `tokenExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `integrations` ADD CONSTRAINT `idx_integration_ws_provider_account` UNIQUE(`workspaceId`,`provider`,`metaAccountId`);