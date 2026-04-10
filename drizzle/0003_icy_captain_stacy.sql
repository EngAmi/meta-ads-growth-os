CREATE TABLE `data_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('meta_ads') NOT NULL DEFAULT 'meta_ads',
	`name` varchar(255) NOT NULL,
	`accessToken` text,
	`adAccountId` varchar(64),
	`connStatus` enum('connected','disconnected','error','syncing') NOT NULL DEFAULT 'disconnected',
	`lastSyncAt` timestamp,
	`lastSyncRows` int DEFAULT 0,
	`lastError` text,
	`syncDays` int DEFAULT 30,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileSize` int,
	`importSource` enum('meta_csv','meta_excel','manual') NOT NULL DEFAULT 'meta_csv',
	`importStatus` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`totalRows` int DEFAULT 0,
	`importedRows` int DEFAULT 0,
	`skippedRows` int DEFAULT 0,
	`errorMessage` text,
	`columnMapping` json,
	`previewData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `import_jobs_id` PRIMARY KEY(`id`)
);
