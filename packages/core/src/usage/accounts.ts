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
import type * as S from '@agent-conductor/shared';
import { nowIso } from '@agent-conductor/db';
import type { AccountsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { credentialReaderFor, reconcileRuntimeCredential } from '../workspace/loader.js';
import { redactSecrets } from '../util/redact.js';

/** A probe may not hold up a tick; the claude CLI answers in well under a second. */
export const ACCOUNT_PROBE_TIMEOUT_MS = 20_000;

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

  /** Every runtime this workspace actually uses: its agents, projects and roles. A runtime nothing uses is never probed. */
  const runtimesInUse = (): string[] => {
    const rows = ctx.db.all<{ runtimeId: string }>(
      `SELECT DISTINCT runtime_id AS runtime_id FROM agents WHERE workspace_id = ? AND retired_at IS NULL
       UNION SELECT DISTINCT runtime_id FROM projects WHERE workspace_id = ?
       UNION SELECT DISTINCT runtime_id FROM roles WHERE workspace_id = ?`,
      [ctx.workspaceId, ctx.workspaceId, ctx.workspaceId],
    );
    return rows.map((r) => r.runtimeId).filter((id): id is string => Boolean(id));
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
        const adapter = ctx.registries.runtimes.get(runtimeId);
        if (!adapter?.describeAccount) continue;
        const configHome = join(ctx.paths.runtimesHome, runtimeId);
        try {
          reconcileRuntimeCredential(runtimeId, configHome, { readCredential: credentialReaderFor(ctx.registries, runtimeId) });
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
          const stored = service.get(runtimeId);
          if (stored) out.push(stored);
          // A probe that described the account proves the credential works. Only the "last seen
          // working" mark is written here: lowering the gate also has to release the agents it
          // paused, which is `ungateRuntime`'s job, not a side effect of a poll (VS-75).
          if (d.billingType !== 'unknown') writeCredential(ctx, runtimeId, { lastVerifiedAt: nowIso() });
          // A probe that could not describe the account says why, and how it tried to launch the
          // CLI: the command it resolved, the cwd and the PATH it searched (VS-73).
          if (d.billingType === 'unknown') log.warn({ runtimeId, note: d.note, ...d.diagnostics }, 'the runtime account probe failed');
          else log.debug({ runtimeId, billingType: d.billingType, limits: d.limits.length }, 'runtime account snapshot refreshed');
        } catch (e) {
          // The previous snapshot stays; a failed probe must not blank out what we last knew.
          log.warn({ runtimeId, err: String(e) }, 'could not describe the runtime account');
        }
      }
      return out;
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
      return writeCredential(ctx, runtimeId, {
        needsLogin: 1,
        refreshFailedAt: nowIso(),
        // The runtime's own words, capped and stripped of anything token-shaped before it is stored.
        detail: detail ? redactSecrets(detail).slice(0, 400) : null,
      });
    },

    noteVerified(runtimeId: string): S.RuntimeCredential {
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
