/**
 * Field state from a schema (VS-212): the settings forms validate their drafts against the same
 * Zod schemas the daemon parses, so the limits live in one place and a form can never reject what
 * the server accepts. `parseFieldIssues` reduces a parse to the first message per field, keyed by
 * the first string in the issue's path.
 */
export interface FieldIssues {
  valid: boolean;
  byPath: Record<string, string>;
}

interface SafeParseIssue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

/** Structural stand-in for any Zod schema, so this module needs no zod import of its own. */
interface SafeParseLike {
  safeParse(value: unknown): { success: boolean; error?: { issues: ReadonlyArray<SafeParseIssue> } };
}

export function parseFieldIssues(schema: SafeParseLike, value: unknown): FieldIssues {
  const result = schema.safeParse(value);
  if (result.success || !result.error) return { valid: true, byPath: {} };
  const byPath: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.find((p): p is string => typeof p === 'string') ?? '';
    if (!(key in byPath)) byPath[key] = issue.message;
  }
  return { valid: false, byPath };
}
