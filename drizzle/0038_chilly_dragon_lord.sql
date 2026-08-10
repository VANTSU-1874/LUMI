CREATE TABLE `agent_student_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`salience` integer DEFAULT 1 NOT NULL,
	`source_turn_id` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`data_type` text GENERATED ALWAYS AS (case when student_id glob 'demo-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`source_turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_student_memory_kind_check" CHECK("agent_student_memory"."kind" in ('LEARNED_CONCEPT','RECURRING_STRUGGLE','PREFERENCE','PROJECT_FACT','MISCONCEPTION_CORRECTED')),
	CONSTRAINT "agent_student_memory_content_check" CHECK(length(trim("agent_student_memory"."content")) between 1 and 2000),
	CONSTRAINT "agent_student_memory_salience_check" CHECK("agent_student_memory"."salience" between 1 and 10),
	CONSTRAINT "agent_student_memory_last_used_check" CHECK("agent_student_memory"."last_used_at" is null or "agent_student_memory"."last_used_at" >= "agent_student_memory"."created_at"),
	CONSTRAINT "agent_student_memory_data_type_check" CHECK("agent_student_memory"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE INDEX `agent_student_memory_student_created_idx` ON `agent_student_memory` (`student_id`,`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_student_memory_student_kind_idx` ON `agent_student_memory` (`student_id`,`class_id`,`kind`,`salience`);--> statement-breakpoint
CREATE INDEX `agent_student_memory_source_turn_idx` ON `agent_student_memory` (`source_turn_id`);--> statement-breakpoint
CREATE TRIGGER `agent_student_memory_owner_source_insert_guard` BEFORE INSERT ON `agent_student_memory`
WHEN NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`student_id` AND `class_id` = NEW.`class_id` AND `role` = 'STUDENT'
) OR (
	NEW.`source_turn_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `agent_turns` AS `turn`
		JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
		WHERE `turn`.`id` = NEW.`source_turn_id`
			AND `conversation`.`student_id` = NEW.`student_id`
			AND `conversation`.`class_id` = NEW.`class_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent student memory owner or source turn');
END;--> statement-breakpoint
CREATE TRIGGER `agent_student_memory_owner_source_update_guard` BEFORE UPDATE OF `student_id`, `class_id`, `source_turn_id` ON `agent_student_memory`
WHEN NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`student_id` AND `class_id` = NEW.`class_id` AND `role` = 'STUDENT'
) OR (
	NEW.`source_turn_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `agent_turns` AS `turn`
		JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
		WHERE `turn`.`id` = NEW.`source_turn_id`
			AND `conversation`.`student_id` = NEW.`student_id`
			AND `conversation`.`class_id` = NEW.`class_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent student memory owner or source turn');
END;
