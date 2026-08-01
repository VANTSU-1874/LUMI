CREATE TABLE `agent_session_summaries` (
	`task_id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`summary` text NOT NULL,
	`through_turn_id` text NOT NULL,
	`through_created_at` integer NOT NULL,
	`covered_turn_count` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when student_id glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`through_turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`,`student_id`,`class_id`) REFERENCES `design_project_tasks`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_session_summaries_content_check" CHECK(length(trim("agent_session_summaries"."summary")) between 1 and 6000),
	CONSTRAINT "agent_session_summaries_turn_count_check" CHECK("agent_session_summaries"."covered_turn_count" > 0),
	CONSTRAINT "agent_session_summaries_revision_check" CHECK("agent_session_summaries"."revision" > 0),
	CONSTRAINT "agent_session_summaries_updated_check" CHECK("agent_session_summaries"."updated_at" >= "agent_session_summaries"."created_at"),
	CONSTRAINT "agent_session_summaries_data_type_check" CHECK("agent_session_summaries"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE INDEX `agent_session_summaries_student_updated_idx` ON `agent_session_summaries` (`student_id`,`class_id`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `agent_session_summaries_turn_owner_insert_guard` BEFORE INSERT ON `agent_session_summaries`
WHEN NOT EXISTS (
	SELECT 1 FROM `agent_turns` AS `turn`
	JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
	WHERE `turn`.`id` = NEW.`through_turn_id`
		AND `conversation`.`task_id` = NEW.`task_id`
		AND `conversation`.`student_id` = NEW.`student_id`
		AND `conversation`.`class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent session summary owner or through turn');
END;--> statement-breakpoint
CREATE TRIGGER `agent_session_summaries_turn_owner_update_guard` BEFORE UPDATE OF `task_id`, `student_id`, `class_id`, `through_turn_id` ON `agent_session_summaries`
WHEN NOT EXISTS (
	SELECT 1 FROM `agent_turns` AS `turn`
	JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
	WHERE `turn`.`id` = NEW.`through_turn_id`
		AND `conversation`.`task_id` = NEW.`task_id`
		AND `conversation`.`student_id` = NEW.`student_id`
		AND `conversation`.`class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent session summary owner or through turn');
END;
