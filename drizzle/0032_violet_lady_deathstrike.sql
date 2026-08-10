CREATE TABLE `design_project_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "design_project_tasks_title_check" CHECK(length(trim("design_project_tasks"."title")) between 1 and 80),
	CONSTRAINT "design_project_tasks_status_check" CHECK("design_project_tasks"."status" in ('ACTIVE','ARCHIVED')),
	CONSTRAINT "design_project_tasks_data_type_check" CHECK("design_project_tasks"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE INDEX `design_project_tasks_student_updated_idx` ON `design_project_tasks` (`student_id`,`status`,`updated_at`);
--> statement-breakpoint
INSERT INTO `design_project_tasks` (`id`,`student_id`,`class_id`,`title`,`status`,`created_at`,`updated_at`,`data_type`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',(random() & 3)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
	u.`id`,
	u.`class_id`,
	coalesce(nullif(trim((
		SELECT substr(t.`student_message`,1,28)
		FROM `agent_turns` t
		JOIN `agent_conversations` c ON c.`id`=t.`conversation_id`
		WHERE c.`student_id`=u.`id` AND c.`class_id`=u.`class_id`
		ORDER BY t.`created_at` DESC, t.`rowid` DESC LIMIT 1
	)),''),'设计项目'),
	'ACTIVE',
	coalesce((SELECT min(c.`created_at`) FROM `agent_conversations` c WHERE c.`student_id`=u.`id` AND c.`class_id`=u.`class_id`),
		(SELECT min(b.`created_at`) FROM `agent_project_briefs` b WHERE b.`student_id`=u.`id` AND b.`class_id`=u.`class_id`),strftime('%s','now')),
	coalesce((SELECT max(c.`updated_at`) FROM `agent_conversations` c WHERE c.`student_id`=u.`id` AND c.`class_id`=u.`class_id`),
		(SELECT max(b.`updated_at`) FROM `agent_project_briefs` b WHERE b.`student_id`=u.`id` AND b.`class_id`=u.`class_id`),strftime('%s','now')),
	case when u.`id` glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end
FROM `users` u
WHERE u.`role`='STUDENT' AND u.`class_id` IS NOT NULL AND (
	EXISTS(SELECT 1 FROM `agent_conversations` c WHERE c.`student_id`=u.`id` AND c.`class_id`=u.`class_id`)
	OR EXISTS(SELECT 1 FROM `agent_project_briefs` b WHERE b.`student_id`=u.`id` AND b.`class_id`=u.`class_id`)
);
--> statement-breakpoint
CREATE TABLE `__new_agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`project_id` text,
	`course_pack_id` text NOT NULL,
	`course_pack_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when student_id glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`task_id`) REFERENCES `design_project_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`class_id`,`student_id`) REFERENCES `projects`(`id`,`class_id`,`student_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_conversations` (`id`,`task_id`,`student_id`,`class_id`,`project_id`,`course_pack_id`,`course_pack_version`,`created_at`,`updated_at`)
SELECT c.`id`,d.`id`,c.`student_id`,c.`class_id`,c.`project_id`,c.`course_pack_id`,c.`course_pack_version`,c.`created_at`,c.`updated_at`
FROM `agent_conversations` c
JOIN `design_project_tasks` d ON d.`student_id`=c.`student_id` AND d.`class_id`=c.`class_id`;
--> statement-breakpoint
DROP TABLE `agent_conversations`;
--> statement-breakpoint
ALTER TABLE `__new_agent_conversations` RENAME TO `agent_conversations`;
--> statement-breakpoint
CREATE INDEX `agent_conversations_student_updated_idx` ON `agent_conversations` (`student_id`,`task_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `agent_conversations_pack_idx` ON `agent_conversations` (`course_pack_id`,`course_pack_version`);
--> statement-breakpoint
CREATE TABLE `__new_agent_project_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`brief_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `design_project_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_project_briefs_revision_check" CHECK("__new_agent_project_briefs"."revision" > 0),
	CONSTRAINT "agent_project_briefs_json_check" CHECK(json_valid("__new_agent_project_briefs"."brief_json") and json_type("__new_agent_project_briefs"."brief_json") = 'object'),
	CONSTRAINT "agent_project_briefs_data_type_check" CHECK("__new_agent_project_briefs"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_project_briefs` (`id`,`task_id`,`student_id`,`class_id`,`brief_json`,`revision`,`created_at`,`updated_at`,`data_type`)
SELECT b.`id`,d.`id`,b.`student_id`,b.`class_id`,b.`brief_json`,b.`revision`,b.`created_at`,b.`updated_at`,b.`data_type`
FROM `agent_project_briefs` b
JOIN `design_project_tasks` d ON d.`student_id`=b.`student_id` AND d.`class_id`=b.`class_id`;
--> statement-breakpoint
DROP TABLE `agent_project_briefs`;
--> statement-breakpoint
ALTER TABLE `__new_agent_project_briefs` RENAME TO `agent_project_briefs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_project_briefs_task_unique` ON `agent_project_briefs` (`task_id`);
--> statement-breakpoint
CREATE INDEX `agent_project_briefs_updated_idx` ON `agent_project_briefs` (`updated_at`);
