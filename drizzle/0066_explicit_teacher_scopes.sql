CREATE TABLE `teacher_access_scopes` (
	`teacher_id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`class_id` text,
	`granted_by` text NOT NULL,
	`grant_reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "teacher_access_scopes_kind_check" CHECK("teacher_access_scopes"."scope_kind" in ('GLOBAL', 'CLASS')),
	CONSTRAINT "teacher_access_scopes_class_check" CHECK(("teacher_access_scopes"."scope_kind" = 'GLOBAL' and "teacher_access_scopes"."class_id" is null) or ("teacher_access_scopes"."scope_kind" = 'CLASS' and "teacher_access_scopes"."class_id" is not null)),
	CONSTRAINT "teacher_access_scopes_audit_check" CHECK(length(trim("teacher_access_scopes"."granted_by")) between 1 and 120 and length(trim("teacher_access_scopes"."grant_reason")) between 1 and 500)
);
--> statement-breakpoint
CREATE INDEX `teacher_access_scopes_class_idx` ON `teacher_access_scopes` (`class_id`);
--> statement-breakpoint
INSERT INTO `teacher_access_scopes` (`teacher_id`,`scope_kind`,`class_id`,`granted_by`,`grant_reason`,`created_at`)
SELECT `id`,'GLOBAL',NULL,'MIGRATION_0066','迁移受控教师访问码所对应的固定课程负责人',`created_at`
FROM `users`
WHERE `id`='teacher' AND `role`='TEACHER' AND `class_id` IS NULL;
