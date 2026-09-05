/**
 * Claude Code account description (PLAN §16.2): billing mode and plan limit windows from the
 * CLI's `get_usage` control request. Costs no model tokens and starts no agent session — the
 * probe writes one control request to a `--input-format stream-json` process and reads the
 * single `control_response` it answers with.
 *
 * Only the normalised `rate_limits.limits[]` array and two scalars are read. The rest of the
 * response (`five_hour`, `seven_day`, a long tail of codename-shaped keys, `spend`,
 * `extra_usage`, `behaviors`) is deliberately ignored: it is not a published contract.
 */
import type { AccountDescription, AccountProbeInput } from '@agent-conductor/runtime-sdk';
import { spawnLines } from '@agent-conductor/runtime-sdk';
import { ACCOUNT_LIMIT_KINDS, type AccountLimitKind, type AccountLimitWindow } from '@agent-conductor/shared';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const KINDS = new Set<string>(ACCOUNT_LIMIT_KINDS);

const LABELS: Record<AccountLimitKind, string> = {
  session: 'Session',
  weekly_all: 'Weekly',
  weekly_scoped: 'Weekly',
};

export const GET_USAGE_REQUEST = `${JSON.stringify({ type: 'control_request', request_id: 'ac_get_usage', request: { subtype: 'get_usage' } })}\n`;

export const PROBE_ARGS = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'] as const;

/** An account we could not describe. The reason is the note, never an exception. */
export function unknownAccount(note: string): AccountDescription {
  return { billingType: 'unknown', planLabel: null, limitsAvailable: false, limits: [], note };
}

/** One entry of `rate_limits.limits[]` → a window, or null when the runtime did not quantify it. */
function window(raw: unknown): AccountLimitWindow | null {
  const l = obj(raw);
  if (!l) return null;
  const kind = str(l['kind']);
  if (!kind || !KINDS.has(kind)) return null;
  const percent = num(l['percent']);
  // A window the runtime does not quantify is omitted rather than drawn at zero.
  if (percent === null) return null;
  const scopeLabel = str(obj(obj(l['scope'])?.['model'])?.['display_name']);
  return {
    kind: kind as AccountLimitKind,
    label: LABELS[kind as AccountLimitKind],
    utilization: Math.max(0, Math.min(100, percent)),
    resetsAt: str(l['resets_at']),
    scopeLabel,
  };
}

/**
 * Pure: one `control_response` line → the account description.
 * Anything unparseable, unsuccessful or shaped unexpectedly degrades to `unknown` with a note.
 */
export function parseUsageControlResponse(line: string): AccountDescription {
  let msg: Json | null;
  try { msg = obj(JSON.parse(line)); } catch { return unknownAccount('claude: the get_usage reply was not JSON'); }
  if (!msg || str(msg['type']) !== 'control_response') return unknownAccount('claude: no get_usage control response');
  const outer = obj(msg['response']);
  if (!outer) return unknownAccount('claude: the get_usage control response had no body');
  if (str(outer['subtype']) === 'error') return unknownAccount(`claude: get_usage failed (${str(outer['error']) ?? 'no reason given'})`);
  const r = obj(outer['response']);
  if (!r) return unknownAccount('claude: the get_usage control response had no body');

  const plan = str(r['subscription_type']);
  // No subscription type means these credentials bill per token.
  if (!plan) return { billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [], note: 'claude: this account is billed per token; it has no plan limits' };

  if (r['rate_limits_available'] !== true) {
    return { billingType: 'subscription_included', planLabel: plan, limitsAvailable: false, limits: [], note: 'claude: the CLI reports that rate limits are unavailable for this account' };
  }
  const raw = obj(r['rate_limits'])?.['limits'];
  const limits = (Array.isArray(raw) ? raw : []).map(window).filter((w): w is AccountLimitWindow => w !== null);
  return limits.length > 0
    ? { billingType: 'subscription_included', planLabel: plan, limitsAvailable: true, limits, note: null }
    : { billingType: 'subscription_included', planLabel: plan, limitsAvailable: false, limits: [], note: 'claude: the CLI reported no usable limit windows' };
}

export interface ProbeOverrides { cmd?: string; args?: readonly string[] }

/**
 * Spawn the CLI, send one `get_usage` control request, describe the account.
 * Always resolves: a missing binary, a non-zero exit and a timeout are all `unknown` with a note.
 */
export async function probeAccount(input: AccountProbeInput, over: ProbeOverrides = {}): Promise<AccountDescription> {
  const env: Record<string, string> = { ...input.env };
  if (input.configHome) env['CLAUDE_CONFIG_DIR'] = input.configHome;

  let answer: string | null = null;
  const run = spawnLines({
    cmd: over.cmd ?? 'claude',
    args: [...(over.args ?? PROBE_ARGS)],
    cwd: input.configHome ?? process.cwd(),
    env,
    stdin: GET_USAGE_REQUEST,
    timeoutMs: input.timeoutMs,
    onLine: (stream, line) => {
      if (stream !== 'stdout' || answer !== null) return;
      if (line.includes('"control_response"')) answer = line;
    },
  });

  const outcome = await run.done;
  if (answer !== null) return parseUsageControlResponse(answer);
  if (outcome.timedOut) return unknownAccount(`claude: the get_usage probe timed out after ${input.timeoutMs} ms`);
  const tail = outcome.stderr.trim().split('\n').pop()?.slice(0, 200) ?? '';
  return unknownAccount(`claude: the get_usage probe returned no control response (exit ${outcome.exitCode ?? 'signal'}${tail ? `: ${tail}` : ''})`);
}
