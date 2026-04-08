CREATE TABLE `ad_insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`adSetId` int,
	`adId` int,
	`date` timestamp NOT NULL,
	`spend` decimal(12,2) DEFAULT '0',
	`impressions` bigint DEFAULT 0,
	`clicks` bigint DEFAULT 0,
	`ctr` decimal(8,4) DEFAULT '0',
	`cpc` decimal(8,2) DEFAULT '0',
	`cpm` decimal(8,2) DEFAULT '0',
	`leads` int DEFAULT 0,
	`costPerLead` decimal(8,2) DEFAULT '0',
	`reach` bigint DEFAULT 0,
	`frequency` decimal(6,2) DEFAULT '0',
	`conversions` int DEFAULT 0,
	`revenue` decimal(12,2) DEFAULT '0',
	`country` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_insights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ad_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adSetId` varchar(64) NOT NULL,
	`campaignId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` enum('active','paused','completed') NOT NULL DEFAULT 'active',
	`targeting` json,
	`bidStrategy` varchar(64),
	`dailyBudget` decimal(12,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_sets_id` PRIMARY KEY(`id`),
	CONSTRAINT `ad_sets_adSetId_unique` UNIQUE(`adSetId`)
);
--> statement-breakpoint
CREATE TABLE `ads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adId` varchar(64) NOT NULL,
	`adSetId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` enum('active','paused','completed') NOT NULL DEFAULT 'active',
	`creativeType` varchar(64),
	`previewUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ads_id` PRIMARY KEY(`id`),
	CONSTRAINT `ads_adId_unique` UNIQUE(`adId`)
);
--> statement-breakpoint
CREATE TABLE `ads_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`currency` varchar(10) NOT NULL DEFAULT 'USD',
	`timezone` varchar(64) NOT NULL DEFAULT 'UTC',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ads_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `ads_accounts_accountId_unique` UNIQUE(`accountId`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` varchar(64) NOT NULL,
	`accountId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`objective` varchar(64),
	`status` enum('active','paused','completed','archived') NOT NULL DEFAULT 'active',
	`dailyBudget` decimal(12,2),
	`totalSpend` decimal(12,2) DEFAULT '0',
	`startDate` timestamp,
	`endDate` timestamp,
	`country` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaigns_campaignId_unique` UNIQUE(`campaignId`)
);
--> statement-breakpoint
CREATE TABLE `daily_summaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` timestamp NOT NULL,
	`totalSpend` decimal(12,2) DEFAULT '0',
	`totalRevenue` decimal(14,2) DEFAULT '0',
	`totalLeads` int DEFAULT 0,
	`totalConversions` int DEFAULT 0,
	`avgCostPerLead` decimal(8,2) DEFAULT '0',
	`avgConversionRate` decimal(6,2) DEFAULT '0',
	`revenueLost` decimal(14,2) DEFAULT '0',
	`keyAlerts` json,
	`aiSummary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_summaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `funnel_bottlenecks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stage` enum('ads','leads','sales','revenue') NOT NULL,
	`severity` enum('critical','warning','info') NOT NULL DEFAULT 'info',
	`title` varchar(255) NOT NULL,
	`description` text,
	`metric` varchar(64),
	`currentValue` decimal(12,2),
	`benchmarkValue` decimal(12,2),
	`revenueImpact` decimal(14,2),
	`country` varchar(64),
	`isResolved` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `funnel_bottlenecks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int,
	`adSetId` int,
	`adId` int,
	`source` varchar(64) DEFAULT 'meta_ads',
	`country` varchar(64),
	`phone` varchar(32),
	`email` varchar(320),
	`name` varchar(255),
	`status` enum('new','contacted','qualified','unqualified','converted','lost') NOT NULL DEFAULT 'new',
	`intentLevel` enum('high','medium','low') DEFAULT 'medium',
	`leadScore` int DEFAULT 50,
	`isFake` boolean DEFAULT false,
	`assignedAgentId` int,
	`firstContactAt` timestamp,
	`responseTimeSeconds` int,
	`contactInfo` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` enum('ads','leads','sales','funnel') NOT NULL,
	`priority` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
	`title` varchar(255) NOT NULL,
	`problem` text,
	`reason` text,
	`action` text,
	`estimatedImpact` decimal(14,2),
	`recStatus` enum('pending','in_progress','completed','dismissed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recommendations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`leadId` int NOT NULL,
	`type` enum('call','message','email','follow_up','meeting','close') NOT NULL,
	`outcome` varchar(64),
	`notes` text,
	`duration` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_agents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320),
	`phone` varchar(32),
	`team` varchar(64),
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`avgResponseTime` int,
	`totalLeads` int DEFAULT 0,
	`totalConversions` int DEFAULT 0,
	`conversionRate` decimal(6,2) DEFAULT '0',
	`totalRevenue` decimal(14,2) DEFAULT '0',
	`followUpRate` decimal(6,2) DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sales_agents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `weekly_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`weekStart` timestamp NOT NULL,
	`weekEnd` timestamp NOT NULL,
	`totalSpend` decimal(12,2) DEFAULT '0',
	`totalRevenue` decimal(14,2) DEFAULT '0',
	`totalLeads` int DEFAULT 0,
	`totalConversions` int DEFAULT 0,
	`revenueGrowth` decimal(8,2) DEFAULT '0',
	`leadGrowth` decimal(8,2) DEFAULT '0',
	`topRecommendations` json,
	`summary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weekly_reports_id` PRIMARY KEY(`id`)
);
