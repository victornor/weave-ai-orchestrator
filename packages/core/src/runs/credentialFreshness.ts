/**
 * VS-105: a burst of simultaneous turn spawns must not become a burst of independent credential
 * refreshes. Claude's OAuth credential rotates its refresh token on every refresh, so several
 * `claude` subprocesses refreshing at once against the one host credential (VS-75) race: the first
 * exchange wins and every other process is left holding a token the server has already invalidated.
 *
 * The daemon never performs the OAuth exchange itself — that stays the CLI's own doing, unchanged.
 * This module only ensures that at most one such refreshing subprocess is in flight per runtime at a
 * time, host-wide (not per workspace: the credential it protects is already shared per host, not per
 * workspace), and that every other caller waits on and reuses that one outcome instead of causing its
 * own. See `design.md` Decision 1 for the alternatives this was chosen over.
 */
import type { AccountDescription, AccountProbeInput, CredentialFacts, RuntimeAdapter } from '@agent-conductor/runtime-sdk';

export interface EnsureFreshCredentialInput {
  runtimeId: string;
  configHome: string;
  adapter: RuntimeAdapter;
  /** The credential must be valid for at least this long from now — the turn's own timeout. */
  minValidMs: number;
  /** How long the priming probe itself may take. */
  probeTimeoutMs: number;
  /** Repairs a forked credential back to one file, by expiry (VS-75). Called before and after a probe. */
  reconcile: () => void;
}

export type FreshResult = { ok: true } | { ok: false; message: string };

/** Not per workspace: the credential a probe refreshes is the one host file every workspace shares. */
const inFlight = new Map<string, Promise<FreshResult>>();

function validFor(facts: CredentialFacts, minValidMs: number): boolean {
  if (!facts.present || !facts.expiresAt) return false;
  const expiresAt = Date.parse(facts.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() >= minValidMs;
}

/** Present, parseable and not already in the past — a probe that left a stale expiry did not help. */
function isCurrentlyValid(facts: CredentialFacts): boolean {
  if (!facts.present || !facts.expiresAt) return false;
  const expiresAt = Date.parse(facts.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/**
 * VS-137: `description.note` is an informational fact about the account (how it is billed, or why it
 * could not be described) — it is never a diagnosis of why the local credential did not check out,
 * and must not be presented as one. It is only reused verbatim when `describeAccount` itself reported
 * a problem (`billingType: 'unknown'`) or could not be reached at all (`description === null`); a
 * successfully described account gets an honest message built from what was actually checked instead
 * of its own unrelated note (this is what previously surfaced a billing note — "this account is
 * billed per token; it has no plan limits" — as the reason a `credential_refresh_failed`).
 */
function messageFor(description: AccountDescription | null, facts: CredentialFacts): string {
  if (!description) return 'the account could not be described, and the local credential is not currently confirmed valid';
  if (description.billingType === 'unknown') return description.note ?? 'the credential could not be confirmed valid after a refresh attempt';
  return `the account was described successfully (billing: ${description.billingType}) but the local credential is ${facts.present ? 'present with no confirmed valid session' : 'missing'} after a refresh attempt`;
}

async function refresh(input: EnsureFreshCredentialInput): Promise<FreshResult> {
  input.reconcile();
  let description: AccountDescription | null = null;
  const probeInput: AccountProbeInput = { configHome: input.configHome, env: {}, timeoutMs: input.probeTimeoutMs };
  if (input.adapter.describeAccount) {
    try { description = await input.adapter.describeAccount(probeInput); } catch { description = null; }
  }
  input.reconcile();
  const facts = input.adapter.readCredential!({ configHome: input.configHome });
  if (isCurrentlyValid(facts)) return { ok: true };
  return { ok: false, message: messageFor(description, facts) };
}

/**
 * Resolve once the runtime's credential at `configHome` is confirmed valid for `minValidMs`, or
 * once a single shared refresh attempt for `runtimeId` has failed to make it so. An adapter that
 * cannot report or refresh its own credential state is a no-op: this changes nothing for it.
 */
export async function ensureFreshCredential(input: EnsureFreshCredentialInput): Promise<FreshResult> {
  if (!input.adapter.readCredential || !input.adapter.describeAccount) return { ok: true };

  input.reconcile();
  if (validFor(input.adapter.readCredential({ configHome: input.configHome }), input.minValidMs)) return { ok: true };

  const existing = inFlight.get(input.runtimeId);
  if (existing) return existing;

  const p = refresh(input).finally(() => inFlight.delete(input.runtimeId));
  inFlight.set(input.runtimeId, p);
  return p;
}
