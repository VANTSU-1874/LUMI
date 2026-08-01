PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_student_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`salience` integer DEFAULT 1 NOT NULL,
	`embedding_json` text,
	`embedding_cache_key` text,
	`source_key` text,
	`source_turn_id` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`student_disputed` integer DEFAULT false NOT NULL,
	`student_dispute_note` text,
	`student_disputed_at` integer,
	`data_type` text GENERATED ALWAYS AS (case when student_id glob 'demo-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`source_turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_student_memory_kind_check" CHECK("__new_agent_student_memory"."kind" in ('LEARNED_CONCEPT','RECURRING_STRUGGLE','PREFERENCE','PROJECT_FACT','MISCONCEPTION_CORRECTED')),
	CONSTRAINT "agent_student_memory_content_check" CHECK(length(trim("__new_agent_student_memory"."content")) between 1 and 2000),
	CONSTRAINT "agent_student_memory_salience_check" CHECK("__new_agent_student_memory"."salience" between 1 and 10),
	CONSTRAINT "agent_student_memory_last_used_check" CHECK("__new_agent_student_memory"."last_used_at" is null or "__new_agent_student_memory"."last_used_at" >= "__new_agent_student_memory"."created_at"),
	CONSTRAINT "agent_student_memory_source_key_check" CHECK(
      "__new_agent_student_memory"."source_key" is null
      or (
        "__new_agent_student_memory"."source_key" in ('ONBOARDING_SELF_ASSESSMENT','ONBOARDING_INTERESTS')
        and "__new_agent_student_memory"."kind" = 'PREFERENCE'
        and "__new_agent_student_memory"."source_turn_id" is null
      )
    ),
	CONSTRAINT "agent_student_memory_dispute_kind_check" CHECK(
      "__new_agent_student_memory"."student_disputed" = 0
      or "__new_agent_student_memory"."kind" in ('LEARNED_CONCEPT','RECURRING_STRUGGLE','MISCONCEPTION_CORRECTED')
    ),
	CONSTRAINT "agent_student_memory_dispute_state_check" CHECK(
      ("__new_agent_student_memory"."student_disputed" = 0 and "__new_agent_student_memory"."student_dispute_note" is null and "__new_agent_student_memory"."student_disputed_at" is null)
      or (
        "__new_agent_student_memory"."student_disputed" = 1
        and "__new_agent_student_memory"."student_disputed_at" is not null
        and "__new_agent_student_memory"."student_disputed_at" >= "__new_agent_student_memory"."created_at"
      )
    ),
	CONSTRAINT "agent_student_memory_dispute_note_check" CHECK(
      "__new_agent_student_memory"."student_dispute_note" is null
      or length(trim("__new_agent_student_memory"."student_dispute_note")) between 1 and 500
    ),
	CONSTRAINT "agent_student_memory_data_type_check" CHECK("__new_agent_student_memory"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_student_memory`(
	"id", "student_id", "class_id", "kind", "content", "salience",
	"embedding_json", "embedding_cache_key", "source_turn_id", "created_at", "last_used_at",
	"student_disputed", "student_dispute_note", "student_disputed_at"
)
SELECT
	"id", "student_id", "class_id", "kind", "content", "salience",
	"embedding_json", "embedding_cache_key", "source_turn_id", "created_at", "last_used_at",
	"student_disputed", "student_dispute_note", "student_disputed_at"
FROM `agent_student_memory`;--> statement-breakpoint
DROP TABLE `agent_student_memory`;--> statement-breakpoint
ALTER TABLE `__new_agent_student_memory` RENAME TO `agent_student_memory`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_student_memory_student_created_idx` ON `agent_student_memory` (`student_id`,`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_student_memory_student_kind_idx` ON `agent_student_memory` (`student_id`,`class_id`,`kind`,`salience`);--> statement-breakpoint
CREATE INDEX `agent_student_memory_source_turn_idx` ON `agent_student_memory` (`source_turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_student_memory_student_source_key_unique` ON `agent_student_memory` (`student_id`,`class_id`,`source_key`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text,
	`role` text NOT NULL,
	`alias` text NOT NULL,
	`nickname` text,
	`major` text,
	`onboarding_completed_at` integer,
	`created_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when id glob 'demo-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" in ('STUDENT', 'TEACHER')),
	CONSTRAINT "users_nickname_check" CHECK("__new_users"."nickname" is null or length(trim("__new_users"."nickname")) between 1 and 40),
	CONSTRAINT "users_major_check" CHECK("__new_users"."major" is null or "__new_users"."major" in ('general-design','digital-interaction','book-design')),
	CONSTRAINT "users_onboarding_role_check" CHECK("__new_users"."role" = 'STUDENT' or ("__new_users"."nickname" is null and "__new_users"."major" is null and "__new_users"."onboarding_completed_at" is null)),
	CONSTRAINT "users_onboarding_completed_at_check" CHECK("__new_users"."onboarding_completed_at" is null or "__new_users"."onboarding_completed_at" >= "__new_users"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "class_id", "role", "alias", "created_at")
SELECT "id", "class_id", "role", "alias", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_id_class_id_unique` ON `users` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_class_id_alias_unique` ON `users` (`class_id`,`alias`);--> statement-breakpoint
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
END;--> statement-breakpoint
CREATE TRIGGER `agent_student_memory_embedding_insert_guard` BEFORE INSERT ON `agent_student_memory`
WHEN CASE
	WHEN NEW.`embedding_json` IS NULL AND NEW.`embedding_cache_key` IS NULL THEN 0
	WHEN NEW.`embedding_json` IS NULL OR NEW.`embedding_cache_key` IS NULL THEN 1
	WHEN length(NEW.`embedding_cache_key`) NOT BETWEEN 1 AND 128 THEN 1
	WHEN length(NEW.`embedding_json`) NOT BETWEEN 3 AND 500000 THEN 1
	WHEN NOT json_valid(NEW.`embedding_json`) THEN 1
	WHEN json_type(NEW.`embedding_json`) != 'array' THEN 1
	WHEN json_array_length(NEW.`embedding_json`) NOT BETWEEN 1 AND 16384 THEN 1
	ELSE 0
END
BEGIN
	SELECT RAISE(ABORT, 'invalid agent student memory embedding');
END;--> statement-breakpoint
CREATE TRIGGER `agent_student_memory_embedding_update_guard` BEFORE UPDATE OF `embedding_json`, `embedding_cache_key` ON `agent_student_memory`
WHEN CASE
	WHEN NEW.`embedding_json` IS NULL AND NEW.`embedding_cache_key` IS NULL THEN 0
	WHEN NEW.`embedding_json` IS NULL OR NEW.`embedding_cache_key` IS NULL THEN 1
	WHEN length(NEW.`embedding_cache_key`) NOT BETWEEN 1 AND 128 THEN 1
	WHEN length(NEW.`embedding_json`) NOT BETWEEN 3 AND 500000 THEN 1
	WHEN NOT json_valid(NEW.`embedding_json`) THEN 1
	WHEN json_type(NEW.`embedding_json`) != 'array' THEN 1
	WHEN json_array_length(NEW.`embedding_json`) NOT BETWEEN 1 AND 16384 THEN 1
	ELSE 0
END
BEGIN
	SELECT RAISE(ABORT, 'invalid agent student memory embedding');
END;
