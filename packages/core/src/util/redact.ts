/**
 * Token-shaped text, replaced before anything stores, shows or sends it (VS-75).
 *
 * The runtime's own error message is the one place a credential can escape by accident: it is
 * written by the CLI, not by us, and it goes onto a decision card, into a channel message to the
 * human and into the stored credential detail. Redacting where the message enters the system, not
 * at each of those three exits, is what keeps a fourth exit from leaking by omission.
 *
 * Deliberately blunt: over-redacting an error message costs nothing, and no caller should be
 * passing a credential here in the first place.
 */
export function redactSecrets(text: string): string {
  return text
    // `sk-ant-...`, `sk-...` and friends
    .replace(/\bsk-[A-Za-z0-9_-]{4,}/g, 'sk-***')
    // a JWT: three dot-separated base64url segments
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '***.***.***')
    // any long opaque run of credential-ish characters
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '***');
}
