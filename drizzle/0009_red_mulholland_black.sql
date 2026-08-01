PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_evidence_recovery_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "evidence_recovery_locks_name_check" CHECK(length("__new_evidence_recovery_locks"."name") between 1 and 80),
	CONSTRAINT "evidence_recovery_locks_owner_check" CHECK(length("__new_evidence_recovery_locks"."owner") = 36),
	CONSTRAINT "evidence_recovery_locks_acquired_at_check" CHECK("__new_evidence_recovery_locks"."acquired_at" >= 0),
	CONSTRAINT "evidence_recovery_locks_expires_at_check" CHECK("__new_evidence_recovery_locks"."expires_at" > "__new_evidence_recovery_locks"."acquired_at")
);
--> statement-breakpoint
INSERT INTO `__new_evidence_recovery_locks`("name", "owner", "acquired_at", "expires_at")
SELECT "name", "owner", "acquired_at", "acquired_at" + 1 FROM `evidence_recovery_locks`;--> statement-breakpoint
DROP TABLE `evidence_recovery_locks`;--> statement-breakpoint
ALTER TABLE `__new_evidence_recovery_locks` RENAME TO `evidence_recovery_locks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
