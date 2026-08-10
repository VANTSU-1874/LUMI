PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_learner_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`decomposition` integer NOT NULL,
	`signal_understanding` integer NOT NULL,
	`mapping_design` integer NOT NULL,
	`troubleshooting` integer NOT NULL,
	`transfer` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when user_id glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learner_profiles_level_check" CHECK("__new_learner_profiles"."level" in ('L1', 'L2', 'L3', 'L4')),
	CONSTRAINT "learner_profiles_decomposition_range_check" CHECK("__new_learner_profiles"."decomposition" in (1, 1.5, 2, 2.5, 3, 3.5, 4)),
	CONSTRAINT "learner_profiles_signal_understanding_range_check" CHECK("__new_learner_profiles"."signal_understanding" in (1, 1.5, 2, 2.5, 3, 3.5, 4)),
	CONSTRAINT "learner_profiles_mapping_design_range_check" CHECK("__new_learner_profiles"."mapping_design" in (1, 1.5, 2, 2.5, 3, 3.5, 4)),
	CONSTRAINT "learner_profiles_troubleshooting_range_check" CHECK("__new_learner_profiles"."troubleshooting" in (1, 1.5, 2, 2.5, 3, 3.5, 4)),
	CONSTRAINT "learner_profiles_transfer_range_check" CHECK("__new_learner_profiles"."transfer" in (1, 1.5, 2, 2.5, 3, 3.5, 4))
);
--> statement-breakpoint
INSERT INTO `__new_learner_profiles`("user_id", "level", "decomposition", "signal_understanding", "mapping_design", "troubleshooting", "transfer", "updated_at") SELECT "user_id", "level", "decomposition", "signal_understanding", "mapping_design", "troubleshooting", "transfer", "updated_at" FROM `learner_profiles`;--> statement-breakpoint
DROP TABLE `learner_profiles`;--> statement-breakpoint
ALTER TABLE `__new_learner_profiles` RENAME TO `learner_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
