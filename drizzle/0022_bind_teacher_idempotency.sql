UPDATE teacher_decisions SET request_hash = tonggan_sha256(json_array(
  class_id, student_id, project_id, target_type, target_id, original_revision, decision, reason_code, notes
));
--> statement-breakpoint
CREATE TRIGGER `teacher_decisions_transfer_validator_insert` BEFORE INSERT ON `teacher_decisions`
WHEN NEW.target_type='TRANSFER' BEGIN
  SELECT CASE WHEN NOT (
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='null'
      AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=0
      AND json_type(NEW.original_snapshot_json,'$.latestOutcome')='null'
      AND json_extract(NEW.original_snapshot_json,'$.status')='OPEN')
    OR
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='object'
      AND tonggan_validate_transfer_rubric(json_extract(NEW.original_snapshot_json,'$.latestRubric'))=1
      AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')=json_extract(NEW.original_snapshot_json,'$.latestRubric.outcome')
      AND ((json_extract(NEW.original_snapshot_json,'$.status')='OPEN' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=1 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='RETRY')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='PASSED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount') BETWEEN 1 AND 2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='PASSED')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='LOCKED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='LOCKED')))
  ) THEN RAISE(ABORT, 'invalid transfer snapshot state') END;
END;
--> statement-breakpoint
CREATE TRIGGER `teacher_decisions_transfer_validator_update` BEFORE UPDATE OF original_snapshot_json,target_type,original_revision ON `teacher_decisions`
WHEN NEW.target_type='TRANSFER' BEGIN
  SELECT CASE WHEN NOT (
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='null'
      AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=0
      AND json_type(NEW.original_snapshot_json,'$.latestOutcome')='null'
      AND json_extract(NEW.original_snapshot_json,'$.status')='OPEN')
    OR
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='object'
      AND tonggan_validate_transfer_rubric(json_extract(NEW.original_snapshot_json,'$.latestRubric'))=1
      AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')=json_extract(NEW.original_snapshot_json,'$.latestRubric.outcome')
      AND ((json_extract(NEW.original_snapshot_json,'$.status')='OPEN' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=1 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='RETRY')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='PASSED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount') BETWEEN 1 AND 2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='PASSED')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='LOCKED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='LOCKED')))
  ) THEN RAISE(ABORT, 'invalid transfer snapshot state') END;
END;
