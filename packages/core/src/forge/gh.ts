import type { ForgeAdapter } from '@agent-conductor/plugin-sdk';
import { OcError } from '@agent-conductor/shared';
import { sh } from '../util/exec.js';

interface GhPrView {
  state?: string;
  mergeCommit?: { oid?: string } | null;
  statusCheckRollup?: Array<{ state?: string; conclusion?: string; status?: string }> | null;
}

function rollupState(rollup: GhPrView['statusCheckRollup']): 'pending' | 'success' | 'failure' | 'none' {
  if (!rollup || rollup.length === 0) return 'none';
  let pending = false;
  for (const c of rollup) {
    const s = (c.conclusion ?? c.state ?? '').toUpperCase();
    const status = (c.status ?? '').toUpperCase();
    if (status && status !== 'COMPLETED') { pending = true; continue; }
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s)) return 'failure';
    if (['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', ''].includes(s)) pending = true;
  }
  return pending ? 'pending' : 'success';
}

/** GitHub forge through the `gh` CLI (auth lives on the daemon host). */
export class GhForge implements ForgeAdapter {
  readonly id = 'github';

  async detect(cwd: string): Promise<boolean> {
    const r = await sh('gh', ['auth', 'status'], { cwd, timeoutMs: 20_000 });
    return r.ok;
  }

  async prState(cwd: string, url: string): Promise<{ state: 'open' | 'merged' | 'closed'; mergeCommit?: string; ciState?: 'pending' | 'success' | 'failure' | 'none' }> {
    const r = await sh('gh', ['pr', 'view', url, '--json', 'state,mergeCommit,statusCheckRollup'], { cwd, timeoutMs: 60_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('internal', `gh pr view failed: ${r.stderr.trim().slice(0, 300)}`, { url });
    let doc: GhPrView;
    try { doc = JSON.parse(r.stdout) as GhPrView; } catch { throw new OcError('internal', 'gh pr view returned invalid JSON', { url }); }
    const raw = (doc.state ?? 'OPEN').toUpperCase();
    const state = raw === 'MERGED' ? 'merged' : raw === 'CLOSED' ? 'closed' : 'open';
    return { state, mergeCommit: doc.mergeCommit?.oid, ciState: rollupState(doc.statusCheckRollup) };
  }

  async mergePr(cwd: string, url: string, method: string): Promise<{ mergeCommit?: string }> {
    const flag = method === 'merge' ? '--merge' : method === 'rebase' ? '--rebase' : '--squash';
    const r = await sh('gh', ['pr', 'merge', url, flag], { cwd, timeoutMs: 300_000, env: { NO_COLOR: '1' } });
    if (!r.ok) throw new OcError('merge_unverified', `gh pr merge failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, { url, method });
    const after = await this.prState(cwd, url).catch(() => null);
    return { mergeCommit: after?.mergeCommit };
  }
}
