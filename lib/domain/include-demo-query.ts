export class InvalidIncludeDemoQueryError extends Error {
  constructor() {
    super("includeDemo must be exactly true or false");
    this.name = "InvalidIncludeDemoQueryError";
  }
}

export function parseIncludeDemoQuery(raw: string | null) {
  if (raw === null || raw === "false") return false;
  if (raw === "true") return true;
  throw new InvalidIncludeDemoQueryError();
}
