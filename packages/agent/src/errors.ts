import type { AgentError } from './types.js';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The message, code and type of an error body, in whichever of the recorded shapes it arrives. */
export interface ParsedBody { message: string; code?: string; type?: string }

/**
 * Reads `{error:{message,code,type}}`, `{error:"text"}` and a bare `{code,message}`. OpenRouter wraps an
 * upstream failure as `Provider returned error` with the upstream body as a JSON string in
 * `metadata.raw`: that inner body is what says what went wrong, so it wins.
 */
export function parseErrorBody(body: string): ParsedBody {
  let message = body.trim().slice(0, 500);
  let code: string | undefined;
  let type: string | undefined;
  try {
    const j = JSON.parse(body) as unknown;
    const e = isObj(j) && (isObj(j['error']) || typeof j['error'] === 'string') ? j['error'] : j;
    if (typeof e === 'string') message = e;
    else if (isObj(e)) {
      if (e['message'] != null) message = String(e['message']);
      if (e['code'] != null) code = String(e['code']);
      if (typeof e['type'] === 'string') type = e['type'];
      const meta = e['metadata'];
      if (isObj(meta) && typeof meta['raw'] === 'string') {
        const inner = parseErrorBody(meta['raw']);
        if (inner.message) message = inner.message;
        code = inner.code ?? (meta['provider_error_code'] != null ? String(meta['provider_error_code']) : code);
        type = inner.type ?? type;
      }
    }
  } catch { /* not JSON: the text is the message */ }
  return { message: message.slice(0, 500), ...(code ? { code } : {}), ...(type ? { type } : {}) };
}

const QUOTA = /insufficient[_ ](quota|balance|funds|credit)|billing|quota|out of credits|credit balance/;
const GATEWAY_EXHAUSTED = /routes failed after \d+ attempts?/i;
const CONTEXT_OVERFLOW = /context[_ ]length|context window|maximum context|maximum.*length|too many tokens|token limit|prompt is too long|reduce the length/;
const MODEL_MISSING = /model.*(not found|not exist|not a valid|not listed|unknown)|unknown model|invalid model|no such model/;
const UNKNOWN_PARAM = /unknown (parameter|field|argument)|unrecognized (request )?(argument|parameter|field)|unsupported parameter|unsupported value|extra inputs? (are|is) not permitted|additional properties/;
/** Z.ai's numeric-string codes seen in the probes: 1211 unknown model, 1214 incorrect role. Others fall through to the status. */
const ZAI_CODES: Record<string, AgentError['code']> = { '1211': 'model_not_found', '1214': 'invalid_request' };

/** Default cap on retries of one transient failure; a row sets `maxRetries` to override. */
export const DEFAULT_MAX_RETRIES = 4;

/**
 * Classify one HTTP failure into a code and a run error family. Order matters: a quota word beats
 * the status, and a gateway that says its routes failed is capped whatever status it chose, because
 * the same body arrives as 502 (upstream error) and as 400 (bad request) for the same cause.
 */
export function classifyHttp(status: number, body: string, retryAfterMs?: number): AgentError {
  const parsed = parseErrorBody(body);
  const { message } = parsed;
  const lower = `${message} ${parsed.code ?? ''} ${parsed.type ?? ''}`.toLowerCase();
  const withRetry = retryAfterMs !== undefined ? { retryAfterMs } : {};
  const base = { message, status };
  if (status === 402 || (QUOTA.test(lower) && (status === 429 || status === 403))) return { code: 'quota_exhausted', family: 'provider_quota', ...base, ...withRetry };
  if (status === 401 || status === 403) return { code: 'auth_failed', family: 'auth', ...base };
  if (GATEWAY_EXHAUSTED.test(message) && (status >= 500 || status === 400)) return { code: 'gateway_routes_failed', family: 'transient_upstream', ...base, maxRetries: 1, ...withRetry };
  if (status === 429) return { code: 'rate_limited', family: 'transient_upstream', ...base, ...withRetry };
  if (status === 408 || status === 409 || status === 529 || status >= 500) return { code: 'upstream_error', family: 'transient_upstream', ...base, ...withRetry };
  if (parsed.code && ZAI_CODES[parsed.code]) return { code: ZAI_CODES[parsed.code]!, family: 'tooling', ...base };
  if (status === 400 && (CONTEXT_OVERFLOW.test(lower) || parsed.code === 'context_length_exceeded')) return { code: 'context_overflow', family: 'resource', ...base };
  if (status === 404 || (status === 400 && MODEL_MISSING.test(lower))) return { code: 'model_not_found', family: 'tooling', ...base };
  if (status === 400 || status === 422) {
    const hint = UNKNOWN_PARAM.test(lower) ? ' Set the matching compat flag or omitParams entry on the provider.' : '';
    return { code: 'invalid_request', family: 'tooling', ...base, message: `${message}${hint}` };
  }
  return { code: 'unknown', family: 'unknown', ...base };
}

/** A top-level `error` inside a 200 stream. A three-digit `code` is a status the provider is passing along. */
export function classifyStreamError(e: { message: string; code?: string; type?: string }): AgentError {
  if (e.code && /^\d{3}$/.test(e.code)) return classifyHttp(Number(e.code), JSON.stringify({ error: { message: e.message, ...(e.type ? { type: e.type } : {}) } }));
  const s = `${e.message} ${e.code ?? ''} ${e.type ?? ''}`.toLowerCase();
  if (QUOTA.test(s)) return { code: 'quota_exhausted', family: 'provider_quota', message: e.message };
  if (GATEWAY_EXHAUSTED.test(s)) return { code: 'gateway_routes_failed', family: 'transient_upstream', message: e.message, maxRetries: 1 };
  if (CONTEXT_OVERFLOW.test(s)) return { code: 'context_overflow', family: 'resource', message: e.message };
  if (/rate.?limit|overload|timeout|unavailable|server_error|temporar|try again|internal/.test(s)) return { code: 'upstream_error', family: 'transient_upstream', message: e.message };
  if (/auth|api key|unauthor/.test(s)) return { code: 'auth_failed', family: 'auth', message: e.message };
  return { code: 'provider_error', family: 'unknown', message: e.message };
}

/** A model that stopped for policy rather than for length. */
export function classifyFinish(finishReason: string | null, refusal: string | undefined): AgentError | null {
  if (finishReason === 'content_filter') return { code: 'refusal', family: 'model_refusal', message: refusal ?? 'The provider filtered the response (finish_reason content_filter).' };
  if (refusal) return { code: 'refusal', family: 'model_refusal', message: refusal };
  return null;
}

const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

/** A failure below HTTP: no response at all, or the connection died. */
export function classifyNetwork(e: unknown): AgentError {
  const err = e as { message?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? err.code ?? '';
  const message = err.cause?.message ?? err.message ?? 'network error';
  if (UNREACHABLE.has(code)) return { code: 'endpoint_unreachable', family: 'tooling', message: `${message} (${code}): check the provider's base URL`, maxRetries: 3 };
  return { code: code === 'ETIMEDOUT' ? 'timeout' : 'network', family: 'transient_upstream', message };
}

/**
 * The loop's own stops. `max_steps`, `budget_exhausted`, `output_truncated`, `tool_call_invalid` and
 * `doom_loop` are `tooling`, never `resource`: the run engine re-queues `resource` (RETRYABLE), and a
 * runaway agent must park for a human rather than run again.
 */
export const stopError = {
  maxSteps: (cap: number): AgentError => ({ code: 'max_steps', family: 'tooling', message: `Stopped after ${cap} steps.` }),
  budget: (used: number, cap: number): AgentError => ({ code: 'budget_exhausted', family: 'tooling', message: `Stopped: ${used} tokens used against a budget of ${cap}.` }),
  truncated: (): AgentError => ({ code: 'output_truncated', family: 'tooling', message: 'The model hit its output limit twice in one turn. Raise maxOutputTokens or split the task.' }),
  invalidCalls: (n: number): AgentError => ({ code: 'tool_call_invalid', family: 'tooling', message: `The model sent ${n} invalid tool calls in a row.` }),
  doom: (name: string): AgentError => ({ code: 'doom_loop', family: 'tooling', message: `Stopped: the model kept repeating the same ${name} call with the same result.` }),
};

/** Whether the ladder may retry this failure at all. `endpoint_unreachable` is `tooling` but gets its three tries. */
export function isRetryable(e: AgentError): boolean {
  return e.maxRetries !== 0 && (e.family === 'transient_upstream' || e.code === 'endpoint_unreachable');
}
