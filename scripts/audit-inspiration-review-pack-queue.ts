import path from "node:path";

import Database from "better-sqlite3";

function scalar(database: Database.Database, sql: string) {
  return (database.prepare(sql).get() as { count: number }).count;
}

function groupedStages(database: Database.Database, table: string) {
  return database.prepare(
    `SELECT stage, count(*) AS count FROM ${table} GROUP BY stage ORDER BY stage`,
  ).all() as Array<{ stage: string; count: number }>;
}

function main() {
  const databaseArgument = process.argv.slice(2).find((value) => value !== "--");
  const databasePath = path.resolve(databaseArgument ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const strictReviewPacks = scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_review_packs");
    const evidenceGapReviewPacks = scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_evidence_gap_review_packs");
    const result = {
      ok: true,
      governanceCandidates: scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_hermes_candidates"),
      strictReviewPacks,
      strictStages: groupedStages(database, "inspiration_wiki_review_packs"),
      strictTeacherDecisions: scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_review_pack_decisions"),
      strictPrivateWikiDrafts: scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_review_packs WHERE stage = 'PRIVATE_WIKIDRAFT'"),
      evidenceGapReviewPacks,
      evidenceGapStages: groupedStages(database, "inspiration_wiki_evidence_gap_review_packs"),
      evidenceGapTeacherDecisions: scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_evidence_gap_review_decisions"),
      evidenceGapPrivateWikiDrafts: scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_evidence_gap_review_packs WHERE stage = 'PRIVATE_WIKIDRAFT_WITH_GAPS'"),
      totalTeacherReviewObjects: strictReviewPacks + evidenceGapReviewPacks,
      reviewedCandidateCoverage: scalar(database, `SELECT count(*) AS count FROM inspiration_wiki_hermes_candidates c
        WHERE EXISTS (SELECT 1 FROM inspiration_wiki_review_packs s WHERE s.candidate_id = c.id)
           OR EXISTS (SELECT 1 FROM inspiration_wiki_evidence_gap_review_packs g WHERE g.candidate_id = c.id)`),
      unassignedCandidates: scalar(database, `SELECT count(*) AS count FROM inspiration_wiki_hermes_candidates c
        WHERE NOT EXISTS (SELECT 1 FROM inspiration_wiki_review_packs s WHERE s.candidate_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM inspiration_wiki_evidence_gap_review_packs g WHERE g.candidate_id = c.id)`),
      dualTrackCandidateViolations: scalar(database, `SELECT count(*) AS count
        FROM inspiration_wiki_review_packs s
        INNER JOIN inspiration_wiki_evidence_gap_review_packs g ON g.candidate_id = s.candidate_id`),
      candidateDraftViolations: scalar(database, "SELECT count(*) AS count FROM inspiration_wiki_hermes_candidates WHERE wiki_draft != 'NOT_CREATED'"),
      candidateExposureViolations: scalar(database, `SELECT count(*) AS count
        FROM inspiration_wiki_hermes_candidates
        WHERE student_visible != 0 OR current_page != 'DISABLED' OR r2 != 'DISABLED'
          OR embedding != 'DISABLED' OR lumi_retrieval != 'DISABLED'`),
      reviewPackExposureViolations: scalar(database, `SELECT count(*) AS count
        FROM inspiration_wiki_review_packs
        WHERE teacher_private != 1 OR student_visible != 0 OR current_page != 'DISABLED'
          OR r2 != 'DISABLED' OR embedding != 'DISABLED' OR lumi_retrieval != 'DISABLED'`),
      evidenceGapExposureViolations: scalar(database, `SELECT count(*) AS count
        FROM inspiration_wiki_evidence_gap_review_packs
        WHERE teacher_private != 1 OR student_visible != 0 OR current_page != 'DISABLED'
          OR r2 != 'DISABLED' OR embedding != 'DISABLED' OR lumi_retrieval != 'DISABLED'`),
      legacyAdmissions: scalar(database, "SELECT count(*) AS count FROM inspiration_admissions"),
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    database.close();
  }
}

main();
