/**
 * agy login failures (VS-995, design §2). Without a usable login a headless agy prints, on stderr:
 *
 *   Authentication required. Please visit the URL to log in:
 *     https://accounts.google.com/o/oauth2/auth?...&code_challenge=...&state=...
 *
 *   Waiting for authentication (timeout 60s)...
 *
 * and then blocks for 60 s before exiting 1 with `authentication failed or timed out` (all captured
 * from 1.5.14 in a sandbox with no credential). Spawned with no terminal at all, as the daemon does,
 * it instead fails at once with `Error: authentication required. Run 'agy' to log in, then retry.`
 * (also captured, through this adapter's own `runTurn`). The adapter kills the turn on the first line instead
 * of waiting, and reports a fixed message: the raw text is never passed to `classifyError`, because
 * the URL's random `state`/`code_challenge` can contain `429` or `503` and be misread as a quota or
 * transient failure — and it has no business in a stored run record anyway.
 */
import type { RunErrorFamily } from '@weave-ai/shared';

/** The stderr line agy prints when it has no usable login and would start an OAuth flow. */
export function isAuthPrompt(line: string): boolean { return /^\s*Authentication required\./.test(line); }

/** Text in a result error or message that means the login is gone (captured / agy changelog). */
export function isAuthFailureText(text: string | null | undefined): boolean {
  if (!text) return false;
  return /authentication failed or timed out|authentication expired|authentication required|not logged into antigravity/i.test(text);
}

export const AUTH_MESSAGE = 'agy is not logged in or its login expired; run `weave runtime login agy` (or `agy` on the daemon\'s host, as the daemon\'s user)';

export function authError(): { code: string; family: RunErrorFamily; message: string } {
  return { code: 'auth', family: 'auth', message: AUTH_MESSAGE };
}
