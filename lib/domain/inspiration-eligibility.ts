import { z } from "zod";

import type { JsonRecord } from "@/lib/db/schema";

export const FormalWikiStudentPublicationInputSchema = z.object({
  publicationScope: z.literal("AUTHENTICATED_STUDENT_ONLY"),
  studentVisible: z.literal(true),
  studentDisplayDecision: z.literal("ALLOW"),
  sourceDisclosureDecision: z.literal("ALLOW"),
  teachingDecision: z.literal("ALLOW"),
  safetyDecision: z.literal("ALLOW"),
  qualityDecision: z.literal("ALLOW"),
  withdrawalReadiness: z.literal("READY"),
  browserChannel: z.literal("ACTIVE"),
  bridgeChannel: z.literal("ACTIVE"),
  publicSource: z.object({
    label: z.string().trim().min(1).max(240).nullable(),
    url: z.string().trim().url().max(2_048).nullable(),
  }).strict(),
}).strict();

export type FormalWikiStudentPublicationInput = z.infer<typeof FormalWikiStudentPublicationInputSchema>;

export type FormalWikiStudentEligibility = {
  candidateState: string;
  admissionStatus: string | null;
  withdrawalStatus: string;
  rights: JsonRecord;
  publicationScope: string | null;
  studentVisible: boolean | null;
  studentDisplayDecision: string | null;
  sourceDisclosureDecision: string | null;
  teachingDecision: string | null;
  safetyDecision: string | null;
  qualityDecision: string | null;
  withdrawalReadiness: string | null;
  browserChannel: string | null;
  bridgeChannel: string | null;
  formalWikiActivationRecorded: boolean | null;
};

export function studentDisplayAllowed(rights: JsonRecord) {
  const decisions = rights.decisions;
  return decisions
    && typeof decisions === "object"
    && (decisions as Record<string, unknown>).STUDENT_DISPLAY === "ALLOW";
}

/**
 * The published Browser, previews, and @灵感 Wiki Bridge share this formal
 * Wiki visibility predicate. It is deliberately a release predicate, not a
 * second per-case AI-citation gate.
 */
export function isFormalWikiStudentEligible(row: FormalWikiStudentEligibility) {
  return row.candidateState === "ACTIVE"
    && row.admissionStatus === "ACTIVE"
    && row.withdrawalStatus === "READY"
    && studentDisplayAllowed(row.rights)
    && row.publicationScope === "AUTHENTICATED_STUDENT_ONLY"
    && row.studentVisible === true
    && row.studentDisplayDecision === "ALLOW"
    && row.sourceDisclosureDecision === "ALLOW"
    && row.teachingDecision === "ALLOW"
    && row.safetyDecision === "ALLOW"
    && row.qualityDecision === "ALLOW"
    && row.withdrawalReadiness === "READY"
    && row.browserChannel === "ACTIVE"
    && row.bridgeChannel === "ACTIVE"
    && row.formalWikiActivationRecorded === true;
}

export function studentPreviewAllowed(rights: JsonRecord) {
  const decisions = rights.decisions;
  return decisions
    && typeof decisions === "object"
    && (decisions as Record<string, unknown>).DERIVE_PREVIEW === "ALLOW";
}
