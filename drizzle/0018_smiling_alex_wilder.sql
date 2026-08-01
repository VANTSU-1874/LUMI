PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`stage` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`evidence_revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignment_id`,`class_id`) REFERENCES `assignments`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projects_stage_check" CHECK("__new_projects"."stage" in ('DIAGNOSTIC', 'LOGIC_CARD', 'TOOL_PATH', 'BUILD', 'TROUBLESHOOT', 'TRANSFER', 'COMPLETE')),
	CONSTRAINT "projects_evidence_revision_check" CHECK("__new_projects"."evidence_revision" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "class_id", "assignment_id", "student_id", "stage", "created_at", "updated_at", "evidence_revision") SELECT "id", "class_id", "assignment_id", "student_id", "stage", "created_at", "updated_at", COALESCE((SELECT MAX(`e`.`evidence_sequence`) FROM `evidence` `e` WHERE `e`.`project_id` = `projects`.`id`), 0) FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_id_class_id_unique` ON `projects` (`id`,`class_id`);--> statement-breakpoint
CREATE INDEX `projects_assignment_id_class_id_idx` ON `projects` (`assignment_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `projects_student_id_class_id_idx` ON `projects` (`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `projects_stage_idx` ON `projects` (`stage`);
