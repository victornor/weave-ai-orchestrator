/**
 * VS-269 / VS-297: an artifact — ticket-scoped or workspace-scoped — is served in an opaque, sandboxed
 * origin so agent-authored HTML can never read the session cookie or call back into the API — not
 * negotiable, per captain's specification. One constant shared by both raw-serve routes so they can
 * never drift apart.
 */
export const ARTIFACT_CSP = "sandbox allow-scripts allow-forms allow-popups allow-downloads; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src data: 'self'; font-src data:; connect-src 'none'";
