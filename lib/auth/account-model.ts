export const LUMI_ACCOUNT_ROLES = ["STUDENT", "TEACHER"] as const;

export type LumiAccountRole = (typeof LUMI_ACCOUNT_ROLES)[number];

export const AUTH_USER_ADDITIONAL_FIELDS = {
  role: {
    type: "string",
    required: true,
    input: true,
  },
  classId: {
    type: "string",
    required: false,
    input: true,
  },
  alias: {
    type: "string",
    required: true,
    input: true,
  },
} as const;

export function isLumiAccountRole(value: unknown): value is LumiAccountRole {
  return value === "STUDENT" || value === "TEACHER";
}

export function destinationForAccountRole(role: LumiAccountRole) {
  return role === "TEACHER" ? "/teacher" : "/student";
}
