/**
 * Runtime account snapshots (PLAN §16.2): how each coding CLI's credentials are billed, and the
 * plan limit windows it reports. One current row per `(workspace, runtime)` — an account is keyed
 * by runtime because `seedRuntimeCredentials` copies credentials per runtime per workspace, not
 * per project.
 *
 * Refreshed by the supervisor poll. A probe that fails leaves the previous snapshot in place: a
 * stale number with a visible capture time beats no number, and beats a wrong one.
 */
import { join } from 'node:path';
import type * as S from '@agent-conductor/shared';
import { nowIso } from '@agent-conductor/db';
import type { AccountsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { seedRuntimeCredentials } from '../workspace/loader.js';

/** A probe may not hold up a tick; the claude CLI answers in well under a second. */
export const ACCOUNT_PROBE_TIMEOUT_MS = 20_000;

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
          seedRuntimeCredentials(runtimeId, configHome);
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
          log.debug({ runtimeId, billingType: d.billingType, limits: d.limits.length }, 'runtime account snapshot refreshed');
        } catch (e) {
          // The previous snapshot stays; a failed probe must not blank out what we last knew.
          log.warn({ runtimeId, err: String(e) }, 'could not describe the runtime account');
        }
      }
      return out;
    },
  };
  return service;
}
