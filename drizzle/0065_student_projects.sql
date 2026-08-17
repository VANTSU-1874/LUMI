CREATE TABLE `student_project_threads` (
	`project_id` text NOT NULL,
	`task_id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `student_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `design_project_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`student_id`,`class_id`) REFERENCES `student_projects`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`,`student_id`,`class_id`) REFERENCES `design_project_tasks`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `student_project_threads_project_created_idx` ON `student_project_threads` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `student_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'folder' NOT NULL,
	`color` text DEFAULT 'emerald' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`memory_mode` text DEFAULT 'PROJECT_ONLY' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "student_projects_name_check" CHECK(length(trim("student_projects"."name")) between 1 and 80),
	CONSTRAINT "student_projects_icon_check" CHECK("student_projects"."icon" in ('folder','book','palette','sparkles','graduation-cap','presentation')),
	CONSTRAINT "student_projects_color_check" CHECK("student_projects"."color" in ('emerald','blue','violet','amber','rose','slate')),
	CONSTRAINT "student_projects_instructions_check" CHECK(length("student_projects"."instructions") <= 6000),
	CONSTRAINT "student_projects_memory_mode_check" CHECK("student_projects"."memory_mode" = 'PROJECT_ONLY'),
	CONSTRAINT "student_projects_status_check" CHECK("student_projects"."status" in ('ACTIVE','ARCHIVED')),
	CONSTRAINT "student_projects_data_type_check" CHECK("student_projects"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_projects_owner_unique` ON `student_projects` (`id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `student_projects_student_updated_idx` ON `student_projects` (`student_id`,`class_id`,`status`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_student_library_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`task_id` text,
	`project_id` text,
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
	FOREIGN KEY (`project_id`) REFERENCES `student_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`student_id`,`class_id`) REFERENCES `student_projects`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "student_library_assets_source_check" CHECK("__new_student_library_assets"."source" = 'DIRECT_UPLOAD'),
	CONSTRAINT "student_library_assets_name_check" CHECK(length(trim("__new_student_library_assets"."original_name")) between 1 and 160),
	CONSTRAINT "student_library_assets_mime_check" CHECK("__new_student_library_assets"."mime_type" in ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "student_library_assets_path_check" CHECK(length("__new_student_library_assets"."storage_path") between 1 and 255),
	CONSTRAINT "student_library_assets_digest_check" CHECK(length("__new_student_library_assets"."digest") = 64 and "__new_student_library_assets"."digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "student_library_assets_size_check" CHECK("__new_student_library_assets"."byte_size" between 1 and 5242880),
	CONSTRAINT "student_library_assets_dimensions_check" CHECK("__new_student_library_assets"."width" between 1 and 10000 and "__new_student_library_assets"."height" between 1 and 10000 and "__new_student_library_assets"."width" * "__new_student_library_assets"."height" <= 12000000),
	CONSTRAINT "student_library_assets_data_type_check" CHECK("__new_student_library_assets"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
INSERT INTO `__new_student_library_assets`("id", "student_id", "class_id", "task_id", "project_id", "source", "original_name", "mime_type", "storage_path", "digest", "byte_size", "width", "height", "created_at", "updated_at") SELECT "id", "student_id", "class_id", "task_id", NULL, "source", "original_name", "mime_type", "storage_path", "digest", "byte_size", "width", "height", "created_at", "updated_at" FROM `student_library_assets`;--> statement-breakpoint
DROP TABLE `student_library_assets`;--> statement-breakpoint
ALTER TABLE `__new_student_library_assets` RENAME TO `student_library_assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `student_library_assets_owner_unique` ON `student_library_assets` (`id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `student_library_assets_student_created_idx` ON `student_library_assets` (`student_id`,`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `student_library_assets_task_created_idx` ON `student_library_assets` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `student_library_assets_project_created_idx` ON `student_library_assets` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `student_library_assets_task_owner_insert`
BEFORE INSERT ON `student_library_assets`
WHEN NEW.`task_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `design_project_tasks`
	WHERE `id` = NEW.`task_id` AND `student_id` = NEW.`student_id` AND `class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'student library task owner mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `student_library_assets_task_owner_update`
BEFORE UPDATE OF `task_id`, `student_id`, `class_id` ON `student_library_assets`
WHEN NEW.`task_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `design_project_tasks`
	WHERE `id` = NEW.`task_id` AND `student_id` = NEW.`student_id` AND `class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'student library task owner mismatch');
END;
