/**
 * Runtime account snapshots (PLAN §16.2): how each coding CLI's credentials are billed, and the
 * plan limit windows it reports. One current row per `(workspace, runtime)` — an account is keyed
 * by runtime because the credential is shared per runtime per host, not per project.
 *
 * Refreshed by the supervisor poll. A probe that fails leaves the previous snapshot in place: a
 * stale number with a visible capture time beats no number, and beats a wrong one.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as S from '@weave-ai/shared';
import { nowIso } from '@weave-ai/db';
import type { AccountsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { credentialReaderFor } from '../workspace/loader.js';
import { redactSecrets } from '../util/redact.js';
import { effectiveModels } from '../models/resolve.js';

/** A probe may not hold up a tick; the claude CLI answers in well under a second. */
export const ACCOUNT_PROBE_TIMEOUT_MS = 20_000;

/**
 * How long an on-demand sync of one runtime blocks the next one (VS-84). A human clicking twice
 * must not become a way to spawn a coding CLI in a loop. Per workspace and runtime, and counted
 * only against manual syncs: the supervisor poll neither consumes this window nor waits on it.
 */
export const MANUAL_SYNC_INTERVAL_MS = 30_000;

/** The credential expiry seen when the runtime's login last failed (VS-769); a `meta` row so a later credential write cannot overwrite it. */
const failedExpiryKey = (runtimeId: string): string => `login:failed_expiry:${runtimeId}`;

interface CredentialRow {
  workspaceId: string; runtimeId: string; present: number; expiresAt: string | null;
  lastVerifiedAt: string | null; refreshFailedAt: string | null; needsLogin: number;
  detail: string | null; updatedAt: string;
}

function toCredential(row: CredentialRow): S.RuntimeCredential {
  return {
    workspaceId: row.workspaceId, runtimeId: row.runtimeId,
    present: row.present === 1, expiresAt: row.expiresAt,
    lastVerifiedAt: row.lastVerifiedAt, refreshFailedAt: row.refreshFailedAt,
    needsLogin: row.needsLogin === 1, detail: row.detail, updatedAt: row.updatedAt,
  };
}

interface AccountRow {
  workspaceId: string; runtimeId: string; billingType: S.BillingType; planLabel: string | null;
  limitsAvailable: number; limits: S.AccountLimitWindow[]; note: string | null; capturedAt: string;
}

function toAccount(row: AccountRow): S.RuntimeAccount {
  return {
    workspaceId: row.workspaceId,
    runtimeId: row.runtimeId,
    billingType: row.billingType,
    planLabel: row.planLabel,
    limitsAvailable: row.limitsAvailable === 1,
    limits: Array.isArray(row.limits) ? row.limits : [],
    note: row.note,
    capturedAt: row.capturedAt,
  };
}

export function createAccountsService(ctx: WorkspaceContext): AccountsService {
  const log = ctx.log('usage');

  /** Every runtime this workspace spends on: its two model settings and any agent still live on another. */
  const runtimesInUse = (): string[] => {
    // The two model settings say what the workspace spends on from here (VS-77). A worker that is
    // still finishing a turn on a runtime a setting has since moved away from is still burning that
    // runtime's quota, so a live agent's own runtime counts too.
    const rows = ctx.db.all<{ runtimeId: string }>(
      'SELECT DISTINCT runtime_id AS runtime_id FROM agents WHERE workspace_id = ? AND retired_at IS NULL',
      [ctx.workspaceId],
    );
    const models = effectiveModels(ctx.daemon, ctx.config);
    const ids = new Set<string>([
      models.weaver.runtime,
      models.workers.runtime,
      ...models.workerOptions.map((o) => o.runtime).filter((id): id is string => id != null),
    ]);
    for (const r of rows) if (r.runtimeId) ids.add(r.runtimeId);
    return [...ids].filter(Boolean).sort();
  };

  /** When each runtime was last probed *on demand*. Per service instance, which is per workspace. */
  const lastManualSync = new Map<string, number>();

  /**
   * Describe one runtime's account and replace its snapshot. Shared by the supervisor poll and the
   * on-demand sync, which differ only in what they do with a probe that threw: the poll leaves the
   * previous snapshot standing and says nothing, the sync says so.
   */
  const probe = async (runtimeId: string): Promise<{ account: S.RuntimeAccount | null; error: string | null }> => {
    const adapter = ctx.registries.runtimes.get(runtimeId);
    if (!adapter?.describeAccount) return { account: null, error: `the ${runtimeId} runtime does not describe its account` };
    const configHome = join(ctx.paths.runtimesHome, runtimeId);
    try {
      // VS-285: a billing/plan read has no business repairing a credential — that stays on the
      // turn-spawn path (`engine.ts`), which still does it on every spawn as it always has.
      const d = await adapter.describeAccount({ configHome, env: {}, timeoutMs: ACCOUNT_PROBE_TIMEOUT_MS });
      const row = {
        workspaceId: ctx.workspaceId,
        runtimeId,
        billingType: d.billingType,
        planLabel: d.planLabel,
        limitsAvailable: d.limitsAvailable ? 1 : 0,
        limitsJson: d.limits,
        note: d.note,
        capturedAt: nowIso(),
      };
      ctx.db.run('DELETE FROM runtime_accounts WHERE workspace_id = ? AND runtime_id = ?', [ctx.workspaceId, runtimeId]);
      ctx.db.insert('runtime_accounts', row);
      // A probe that described the account proves the credential works. Only the "last seen
      // working" mark is written here: lowering the gate also has to release the agents it
      // paused, which is `ungateRuntime`'s job, not a side effect of a poll (VS-75).
      if (d.billingType !== 'unknown') writeCredential(ctx, runtimeId, { lastVerifiedAt: nowIso() });
      // A probe that could not describe the account says why, and how it tried to launch the
      // CLI: the command it resolved, the cwd and the PATH it searched (VS-73). The snapshot it
      // wrote carries the note, so the surfaces say so too rather than showing stale numbers.
      if (d.billingType === 'unknown') log.warn({ runtimeId, note: d.note, ...d.diagnostics }, 'the runtime account probe failed');
      else log.debug({ runtimeId, billingType: d.billingType, limits: d.limits.length }, 'runtime account snapshot refreshed');
      return { account: service.get(runtimeId), error: null };
    } catch (e) {
      // The previous snapshot stays; a failed probe must not blank out what we last knew.
      log.warn({ runtimeId, err: String(e) }, 'could not describe the runtime account');
      return { account: null, error: String(e instanceof Error ? e.message : e) };
    }
  };

  const service: AccountsService = {
    list(): S.RuntimeAccount[] {
      return ctx.db
        .all<AccountRow>('SELECT * FROM runtime_accounts WHERE workspace_id = ? ORDER BY runtime_id', [ctx.workspaceId])
        .map(toAccount);
    },

    get(runtimeId: string): S.RuntimeAccount | null {
      const row = ctx.db.get<AccountRow>('SELECT * FROM runtime_accounts WHERE workspace_id = ? AND runtime_id = ?', [ctx.workspaceId, runtimeId]);
      return row ? toAccount(row) : null;
    },

    async refresh(runtimeIds?: string[]): Promise<S.RuntimeAccount[]> {
      const ids = runtimeIds ?? runtimesInUse();
      const out: S.RuntimeAccount[] = [];
      for (const runtimeId of ids) {
        // The poll swallows a failure by design: the previous snapshot stays, and a stale number
        // with a visible capture time beats no number. `sync` is the caller that reports it.
        const { account } = await probe(runtimeId);
        if (account) out.push(account);
      }
      return out;
    },

    /**
     * A human asked for the numbers now (VS-84). Probes every requested runtime that is outside its
     * rate limit window, and answers with the current snapshot of all of them — freshly probed or
     * not — so the caller can render the same block either way, plus what it refused and what it
     * could not describe.
     */
    async sync(runtimeIds?: string[]): Promise<S.AccountSync> {
      const ids = runtimeIds ?? runtimesInUse();
      const synced: string[] = [];
      const throttled: S.AccountSyncThrottle[] = [];
      const failed: S.AccountSyncFailure[] = [];
      const now = Date.now();
      for (const runtimeId of ids) {
        const last = lastManualSync.get(runtimeId) ?? 0;
        const retryAfterMs = last + MANUAL_SYNC_INTERVAL_MS - now;
        if (retryAfterMs > 0) {
          throttled.push({ runtimeId, nextSyncAt: new Date(last + MANUAL_SYNC_INTERVAL_MS).toISOString(), retryAfterMs });
          continue;
        }
        // The clock starts at the request, not at the answer: a probe that hangs for its whole
        // timeout must not leave the runtime open to another one the moment it gives up.
        lastManualSync.set(runtimeId, now);
        const { account, error } = await probe(runtimeId);
        if (error) failed.push({ runtimeId, message: error });
        else if (account) synced.push(runtimeId);
      }
      // Every runtime that was asked about, in the order it was asked about, whatever happened to
      // it: the block on screen is drawn from this list and must not lose a row to a failed probe.
      const accounts = ids.map((id) => service.get(id)).filter((a): a is S.RuntimeAccount => a !== null);
      return { accounts, synced, throttled, failed };
    },

    // ---------- credential state (VS-75) ----------

    credentials(): S.RuntimeCredential[] {
      return ctx.db
        .all<CredentialRow>('SELECT * FROM runtime_credentials WHERE workspace_id = ? ORDER BY runtime_id', [ctx.workspaceId])
        .map(toCredential);
    },

    /**
     * The stored state, with `present` and `expiresAt` re-read from the credential file every time:
     * those are facts about a file on disk that the owner can change at any moment, and a cached
     * copy of them is the class of bug this whole change exists to remove. The read spawns nothing.
     */
    credential(runtimeId: string): S.RuntimeCredential {
      const facts = readCredentialFacts(ctx, runtimeId);
      const row = ctx.db.get<CredentialRow>('SELECT * FROM runtime_credentials WHERE workspace_id = ? AND runtime_id = ?', [ctx.workspaceId, runtimeId]);
      if (!row) {
        return {
          workspaceId: ctx.workspaceId, runtimeId,
          present: facts.present, expiresAt: facts.expiresAt,
          lastVerifiedAt: null, refreshFailedAt: null, needsLogin: false, detail: null,
          updatedAt: nowIso(),
        };
      }
      return { ...toCredential(row), present: facts.present, expiresAt: facts.expiresAt };
    },

    gatedRuntimes(): string[] {
      return ctx.db
        .all<{ runtimeId: string }>('SELECT runtime_id FROM runtime_credentials WHERE workspace_id = ? AND needs_login = 1', [ctx.workspaceId])
        .map((r) => r.runtimeId);
    },

    noteAuthFailure(runtimeId: string, detail: string | null): S.RuntimeCredential {
      // VS-769: remember which credential failed, so a later probe cannot mistake "the CLI still
      // describes the account" for "someone logged in again". The OAuth access token can outlive
      // a dead refresh token, so the expiry only moves when the login really changed.
      const failed = readCredentialFacts(ctx, runtimeId);
      ctx.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [failedExpiryKey(runtimeId), failed.expiresAt ?? '']);
      return writeCredential(ctx, runtimeId, {
        needsLogin: 1,
        refreshFailedAt: nowIso(),
        // The runtime's own words, capped and stripped of anything token-shaped before it is stored.
        detail: detail ? redactSecrets(detail).slice(0, 400) : null,
      });
    },

    loginChangedSinceFailure(runtimeId: string): boolean {
      const recorded = ctx.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [failedExpiryKey(runtimeId)])?.value;
      if (recorded === undefined) return true;           // gated before this was recorded: the probe is all there is
      const current = readCredentialFacts(ctx, runtimeId).expiresAt ?? '';
      if (recorded === '' && current === '') return true; // the runtime does not report an expiry: nothing to compare
      return current !== recorded;
    },

    noteVerified(runtimeId: string): S.RuntimeCredential {
      ctx.db.run('DELETE FROM meta WHERE key = ?', [failedExpiryKey(runtimeId)]);
      return writeCredential(ctx, runtimeId, { needsLogin: 0, refreshFailedAt: null, detail: null, lastVerifiedAt: nowIso() });
    },
  };
  return service;
}


/** What the runtime says about its credential file, or "absent" when it cannot say (no CLI is spawned). */
function readCredentialFacts(ctx: WorkspaceContext, runtimeId: string): { present: boolean; expiresAt: string | null } {
  const read = credentialReaderFor(ctx.registries, runtimeId);
  if (!read) {
    // The runtime does not describe its credential. Report what we can see without interpreting it:
    // a config home that exists means a credential may well be there, but its expiry is unknown —
    // never guessed, and never reported as absent.
    return { present: existsSync(join(ctx.paths.runtimesHome, runtimeId)), expiresAt: null };
  }
  try { return read(join(ctx.paths.runtimesHome, runtimeId)); } catch { return { present: false, expiresAt: null }; }
}

/** Upsert the mutable half of the row; `present`/`expiresAt` always come from the file on read. */
function writeCredential(ctx: WorkspaceContext, runtimeId: string, patch: Record<string, unknown>): S.RuntimeCredential {
  const facts = readCredentialFacts(ctx, runtimeId);
  const now = nowIso();
  const existing = ctx.db.get<CredentialRow>('SELECT * FROM runtime_credentials WHERE workspace_id = ? AND runtime_id = ?', [ctx.workspaceId, runtimeId]);
  const row = {
    workspaceId: ctx.workspaceId, runtimeId,
    present: facts.present ? 1 : 0, expiresAt: facts.expiresAt,
    lastVerifiedAt: existing?.lastVerifiedAt ?? null,
    refreshFailedAt: existing?.refreshFailedAt ?? null,
    needsLogin: existing?.needsLogin ?? 0,
    detail: existing?.detail ?? null,
    ...patch,
    updatedAt: now,
  };
  ctx.db.run('DELETE FROM runtime_credentials WHERE workspace_id = ? AND runtime_id = ?', [ctx.workspaceId, runtimeId]);
  ctx.db.insert('runtime_credentials', row);
  return toCredential(ctx.db.get<CredentialRow>('SELECT * FROM runtime_credentials WHERE workspace_id = ? AND runtime_id = ?', [ctx.workspaceId, runtimeId])!);
}
