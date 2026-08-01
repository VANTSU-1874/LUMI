CREATE TABLE `agent_run_artwork_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`storage_path` text NOT NULL,
	`digest` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_run_artwork_inputs_mime_check" CHECK("agent_run_artwork_inputs"."mime_type" in ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "agent_run_artwork_inputs_path_check" CHECK(length("agent_run_artwork_inputs"."storage_path") between 1 and 255),
	CONSTRAINT "agent_run_artwork_inputs_digest_check" CHECK(length("agent_run_artwork_inputs"."digest") = 64 and "agent_run_artwork_inputs"."digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_run_artwork_inputs_size_check" CHECK("agent_run_artwork_inputs"."byte_size" between 1 and 5242880),
	CONSTRAINT "agent_run_artwork_inputs_dimensions_check" CHECK("agent_run_artwork_inputs"."width" between 1 and 10000 and "agent_run_artwork_inputs"."height" between 1 and 10000 and "agent_run_artwork_inputs"."width" * "agent_run_artwork_inputs"."height" <= 12000000),
	CONSTRAINT "agent_run_artwork_inputs_data_type_check" CHECK("agent_run_artwork_inputs"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_artwork_inputs_run_unique` ON `agent_run_artwork_inputs` (`run_id`);