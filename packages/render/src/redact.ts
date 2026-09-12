/**
 * Secret redaction for anything that reaches a screen. Run events carry raw tool output,
 * so this is the single place that decides what a human is allowed to see (PLAN §21.3).
 */

export const REDACTED = '[redacted]';

interface Rule { re: RegExp; replace: (m: string, ...groups: string[]) => string }

const keep = (prefix: string) => (m: string) => `${prefix}${REDACTED}`;

const RULES: Rule[] = [
  // Weave AI run tokens and session tokens.
  { re: /\brt_[A-Za-z0-9_-]{8,}/g, replace: keep('rt_') },
  { re: /\boc_[A-Za-z0-9_-]{16,}/g, replace: keep('weave_') },
  // Provider keys.
  { re: /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{16,}/g, replace: keep('sk-') },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, replace: (m) => `${m.slice(0, 4)}${REDACTED}` },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: keep('github_pat_') },
  { re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: (m) => `${m.slice(0, 5)}${REDACTED}` },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: keep('AKIA') },
  { re: /\bAIza[0-9A-Za-z_-]{20,}/g, replace: keep('AIza') },
  { re: /\bglpat-[A-Za-z0-9_-]{16,}/g, replace: keep('glpat-') },
  // Bearer / Basic headers.
  { re: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: (_m, scheme) => `${scheme} ${REDACTED}` },
  // key=value and "key": "value" for secret-ish names.
  {
    re: /\b((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password|passwd|private[_-]?key|client[_-]?secret)"?\s*[:=]\s*"?)([^\s"',;)}]{6,})/gi,
    replace: (_m, head) => `${head}${REDACTED}`,
  },
  // JWTs.
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: () => REDACTED },
  // URLs carrying credentials.
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, replace: (_m, scheme, user) => `${scheme}${user}:${REDACTED}@` },
];

/** Redact secrets from a string. Idempotent, never throws, preserves length-independent structure. */
export function redact(text: string | null | undefined): string {
  if (!text) return text === '' ? '' : '';
  let out = text;
  for (const rule of RULES) out = out.replace(rule.re, rule.replace as (substring: string, ...args: unknown[]) => string);
  return out;
}

/** Deep-redact a payload: strings are scrubbed, secret-named keys are dropped entirely. */
const SECRET_KEY = /^(authorization|cookie|set-cookie|token|api[_-]?key|apikey|password|passwd|secret|client[_-]?secret|private[_-]?key)$/i;

export function redactValue<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}
