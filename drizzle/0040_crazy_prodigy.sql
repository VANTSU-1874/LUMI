ALTER TABLE `agent_student_memory` ADD `embedding_json` text;--> statement-breakpoint
ALTER TABLE `agent_student_memory` ADD `embedding_cache_key` text;--> statement-breakpoint
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
