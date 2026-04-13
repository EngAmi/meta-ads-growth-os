ALTER TABLE `pipeline_runs` MODIFY COLUMN `stepResults` json NOT NULL;--> statement-breakpoint
ALTER TABLE `pipeline_runs` MODIFY COLUMN `stepErrors` json NOT NULL;