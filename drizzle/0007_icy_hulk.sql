CREATE TABLE `meta_oauth_sessions` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`longLivedToken` text NOT NULL,
	`adAccountsJson` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meta_oauth_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_meta_session_user` ON `meta_oauth_sessions` (`userId`);