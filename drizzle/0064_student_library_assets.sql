CREATE TABLE `student_library_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`task_id` text,
	`source` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`storage_path` text NOT NULL,
	`digest` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when student_id glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`task_id`) REFERENCES `design_project_tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "student_library_assets_source_check" CHECK("student_library_assets"."source" = 'DIRECT_UPLOAD'),
	CONSTRAINT "student_library_assets_name_check" CHECK(length(trim("student_library_assets"."original_name")) between 1 and 160),
	CONSTRAINT "student_library_assets_mime_check" CHECK("student_library_assets"."mime_type" in ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "student_library_assets_path_check" CHECK(length("student_library_assets"."storage_path") between 1 and 255),
	CONSTRAINT "student_library_assets_digest_check" CHECK(length("student_library_assets"."digest") = 64 and "student_library_assets"."digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "student_library_assets_size_check" CHECK("student_library_assets"."byte_size" between 1 and 5242880),
	CONSTRAINT "student_library_assets_dimensions_check" CHECK("student_library_assets"."width" between 1 and 10000 and "student_library_assets"."height" between 1 and 10000 and "student_library_assets"."width" * "student_library_assets"."height" <= 12000000),
	CONSTRAINT "student_library_assets_data_type_check" CHECK("student_library_assets"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_library_assets_owner_unique` ON `student_library_assets` (`id`,`student_id`,`class_id`);
--> statement-breakpoint
CREATE INDEX `student_library_assets_student_created_idx` ON `student_library_assets` (`student_id`,`class_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `student_library_assets_task_created_idx` ON `student_library_assets` (`task_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `student_library_assets_task_owner_insert`
BEFORE INSERT ON `student_library_assets`
WHEN NEW.`task_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `design_project_tasks`
	WHERE `id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'student library task owner mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `student_library_assets_task_owner_update`
BEFORE UPDATE OF `task_id`, `student_id`, `class_id` ON `student_library_assets`
WHEN NEW.`task_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `design_project_tasks`
	WHERE `id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'student library task owner mismatch');
END;
