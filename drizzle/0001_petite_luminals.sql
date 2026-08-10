CREATE TABLE `auth_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`blocked_until` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "auth_rate_limits_key_hash_check" CHECK(length("auth_rate_limits"."key_hash") = 64),
	CONSTRAINT "auth_rate_limits_failures_check" CHECK("auth_rate_limits"."failures" >= 0)
);
--> statement-breakpoint
CREATE INDEX `auth_rate_limits_blocked_until_idx` ON `auth_rate_limits` (`blocked_until`);