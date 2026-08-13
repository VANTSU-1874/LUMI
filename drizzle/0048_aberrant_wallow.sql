CREATE TABLE `agent_run_interventions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`source_run_id` text NOT NULL,
	`predecessor_run_id` text NOT NULL,
	`user_message_id` text NOT NULL,
	`requested_mode` text NOT NULL,
	`actual_mode` text NOT NULL,
	`queue_sequence` integer NOT NULL,
	`next_run_id` text NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`activated_at` integer,
	`completed_at` integer,
	`data_type` text NOT NULL,
	FOREIGN KEY (`source_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`predecessor_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_message_id`) REFERENCES `agent_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`next_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`,`student_id`,`class_id`) REFERENCES `design_project_tasks`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_run_interventions_requested_mode_check" CHECK("agent_run_interventions"."requested_mode" in ('FOLLOW_UP','STEER')),
	CONSTRAINT "agent_run_interventions_actual_mode_check" CHECK("agent_run_interventions"."actual_mode" in ('FOLLOW_UP','STEER')),
	CONSTRAINT "agent_run_interventions_status_check" CHECK("agent_run_interventions"."status" in ('QUEUED','ACTIVE','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "agent_run_interventions_sequence_check" CHECK("agent_run_interventions"."queue_sequence" > 0),
	CONSTRAINT "agent_run_interventions_key_check" CHECK(length("agent_run_interventions"."idempotency_key") between 1 and 128),
	CONSTRAINT "agent_run_interventions_hash_check" CHECK(length("agent_run_interventions"."request_hash") = 64 and "agent_run_interventions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_run_interventions_timeline_check" CHECK(
        "agent_run_interventions"."updated_at" >= "agent_run_interventions"."created_at"
        and (
          ("agent_run_interventions"."status" = 'QUEUED' and "agent_run_interventions"."activated_at" is null and "agent_run_interventions"."completed_at" is null)
          or ("agent_run_interventions"."status" = 'ACTIVE' and "agent_run_interventions"."activated_at" is not null and "agent_run_interventions"."completed_at" is null)
          or ("agent_run_interventions"."status" in ('COMPLETED','FAILED','CANCELLED') and "agent_run_interventions"."completed_at" is not null)
        )
      ),
	CONSTRAINT "agent_run_interventions_data_type_check" CHECK("agent_run_interventions"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_interventions_student_key_unique` ON `agent_run_interventions` (`student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_interventions_task_sequence_unique` ON `agent_run_interventions` (`task_id`,`queue_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_interventions_message_unique` ON `agent_run_interventions` (`user_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_interventions_next_run_unique` ON `agent_run_interventions` (`next_run_id`);--> statement-breakpoint
CREATE INDEX `agent_run_interventions_task_status_idx` ON `agent_run_interventions` (`task_id`,`status`,`queue_sequence`);--> statement-breakpoint
CREATE TRIGGER `agent_run_interventions_owner_insert_guard` BEFORE INSERT ON `agent_run_interventions`
WHEN NOT EXISTS (
	SELECT 1 FROM `agent_runs`
	WHERE `id` = NEW.`source_run_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `data_type` = NEW.`data_type`
) OR NOT EXISTS (
	SELECT 1 FROM `agent_runs`
	WHERE `id` = NEW.`predecessor_run_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `data_type` = NEW.`data_type`
) OR NOT EXISTS (
	SELECT 1 FROM `agent_runs`
	WHERE `id` = NEW.`next_run_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `data_type` = NEW.`data_type`
		AND json_extract(`request_json`, '$.clientMessageId') = NEW.`user_message_id`
) OR NOT EXISTS (
	SELECT 1 FROM `agent_messages`
	WHERE `id` = NEW.`user_message_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `role` = 'user'
		AND `data_type` = NEW.`data_type`
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent run intervention owner or reference');
END;--> statement-breakpoint
CREATE TRIGGER `agent_run_interventions_owner_update_guard` BEFORE UPDATE OF `task_id`, `student_id`, `class_id`, `source_run_id`, `predecessor_run_id`, `user_message_id`, `next_run_id`, `data_type` ON `agent_run_interventions`
WHEN NOT EXISTS (
	SELECT 1 FROM `agent_runs`
	WHERE `id` = NEW.`source_run_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `data_type` = NEW.`data_type`
) OR NOT EXISTS (
	SELECT 1 FROM `agent_runs`
	WHERE `id` = NEW.`predecessor_run_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `data_type` = NEW.`data_type`
) OR NOT EXISTS (
	SELECT 1 FROM `agent_runs`
	WHERE `id` = NEW.`next_run_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `data_type` = NEW.`data_type`
		AND json_extract(`request_json`, '$.clientMessageId') = NEW.`user_message_id`
) OR NOT EXISTS (
	SELECT 1 FROM `agent_messages`
	WHERE `id` = NEW.`user_message_id`
		AND `task_id` = NEW.`task_id`
		AND `student_id` = NEW.`student_id`
		AND `class_id` = NEW.`class_id`
		AND `role` = 'user'
		AND `data_type` = NEW.`data_type`
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent run intervention owner or reference');
END;
