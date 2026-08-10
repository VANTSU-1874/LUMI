CREATE TABLE `agent_external_search_consents` (
	`nonce` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`task_id` text NOT NULL,
	`message_digest` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`consumed_at_ms` integer NOT NULL,
	`run_id` text,
	`used_at_ms` integer,
	`data_type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`,`student_id`,`class_id`) REFERENCES `design_project_tasks`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_external_search_consents_digest_check" CHECK(
      length("agent_external_search_consents"."message_digest") = 64
      and "agent_external_search_consents"."message_digest" not glob '*[^0-9a-f]*'
    ),
	CONSTRAINT "agent_external_search_consents_time_check" CHECK(
      "agent_external_search_consents"."issued_at_ms" >= 0
      and "agent_external_search_consents"."consumed_at_ms" >= "agent_external_search_consents"."issued_at_ms" - 30000
      and "agent_external_search_consents"."consumed_at_ms" <= "agent_external_search_consents"."issued_at_ms" + 600000
      and ("agent_external_search_consents"."used_at_ms" is null or (
        "agent_external_search_consents"."used_at_ms" >= "agent_external_search_consents"."issued_at_ms" - 30000
        and "agent_external_search_consents"."used_at_ms" <= "agent_external_search_consents"."issued_at_ms" + 600000
      ))
    ),
	CONSTRAINT "agent_external_search_consents_data_type_check" CHECK(
      "agent_external_search_consents"."data_type" in ('REAL','DEMONSTRATION_DATA')
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_external_search_consents_run_unique` ON `agent_external_search_consents` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_external_search_consents_student_consumed_idx` ON `agent_external_search_consents` (`student_id`,`class_id`,`consumed_at_ms`);