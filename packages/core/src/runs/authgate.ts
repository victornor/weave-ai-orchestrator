/**
 * The per-runtime login gate (VS-75, runtime-credentials/login-outage).
 *
 * One credential is shared per runtime per host, so a failure to authenticate is a fact about the
 * runtime, not about the turn that happened to hit it first. Retrying it can only fail again, and
 * parking each worker turns one expired login into a card per worker that each say something
 * different and none of which says "run `claude /login`".
 *
 * So the first such failure gates the runtime: the dispatcher starts no further turn on it, every
 * agent waiting on it is paused *with its wake-ups still queued*, exactly one decision is raised,
 * and the human is told over the channel path rather than through a conductor turn — the conductor
 * may be on the same runtime and therefore unable to take one. The supervisor's probe clears all of
 * it again without the human answering anything.
 */
import { nowIso } from '@agent-conductor/db';
import { LOGIN_PAUSE_CODE, type Agent } from '@agent-conductor/shared';
import type { CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { redactSecrets } from '../util/redact.js';

export { LOGIN_PAUSE_CODE } from '@agent-conductor/shared';

/** One open card per runtime, whatever fails and however often. */
export const loginCorrelationKey = (runtimeId: string): string => `runtime-login:${runtimeId}`;

const pauseReason = (runtimeId: string): string => `${LOGIN_PAUSE_CODE}: the ${runtimeId} login expired`;

export const loginDecisionTitle = (runtimeId: string): string => `The ${runtimeId} login expired — log in again to resume`;

export function loginDecisionContext(runtimeId: string, detail: string | null): string {
  return [
    `Every agent on the ${runtimeId} runtime is stopped: its credential could not be refreshed.`,
    detail ? `The runtime said: ${detail}` : null,
    '',
    `Run \`${runtimeId} /login\` on the daemon's host (for Claude Code: \`claude /login\`).`,
    'Nothing else is needed — the work resumes on its own within a minute of the login working again,',
    'and this card withdraws itself. No worker needs to be resumed by hand.',
  ].filter((l) => l !== null).join('\n');
}

/** Agents this workspace would run on `runtimeId`, whatever their current status. */
function agentsOn(ctx: WorkspaceContext, runtimeId: string): Agent[] {
  return ctx.db.all<Agent>(
    'SELECT * FROM agents WHERE workspace_id = ? AND runtime_id = ? AND retired_at IS NULL',
    [ctx.workspaceId, runtimeId],
  );
}

/**
 * Raise the gate for `runtimeId`. Idempotent: the second failure of an outage finds the gate up and
 * the card open, and does nothing but re-record the detail.
 *
 * Every step is guarded on its own, in the style of `parkForHuman`: this is the last thing that
 * happens before a human has to notice by hand, so one step failing must not take the others with
 * it (VS-49's lesson), and none of it may fail quietly.
 */
export function gateRuntimeForLogin(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  input: { runtimeId: string; agentId?: string | null; runId?: string | null },
  rawDetail: string | null,
): void {
  const log = ctx.log('run');
  const { runtimeId } = input;
  // Redacted here, once, rather than at each of the three exits below — the card, the channel
  // message and the stored state. A fourth exit added later inherits it rather than leaking.
  const detail = rawDetail ? redactSecrets(rawDetail) : null;
  const step = (name: string, fn: () => void): void => {
    try { fn(); } catch (e) { log.error({ err: String(e), step: name, runtimeId }, `gating ${runtimeId} for an expired login failed at ${name}`); }
  };

  step('record the credential failure', () => { deps().accounts.noteAuthFailure(runtimeId, detail); });

  // Pause every agent on the runtime, not only the one that failed: they would each fail the same
  // way within a tick. Their queued wake-ups are deliberately left alone — the dispatcher skips a
  // gated runtime before it claims anything, so the work waits rather than being lost and re-asked.
  step('pause the runtime’s agents', () => {
    const now = nowIso();
    for (const a of agentsOn(ctx, runtimeId)) {
      if (a.status === 'paused') continue;
      ctx.db.update('agents', a.id, {
        status: 'paused',
        pauseReason: pauseReason(runtimeId),
        pauseDetailJson: {
          family: 'auth', code: LOGIN_PAUSE_CODE,
          message: detail ? detail.slice(0, 400) : null,
          resetAt: null, runId: a.id === input.agentId ? input.runId ?? null : null,
        },
        updatedAt: now,
      });
    }
  });

  // True only when *this* call raised the card. A second failure during the same outage finds it
  // open and stays quiet: the human has already been told, and telling them again on every failing
  // agent is the per-worker noise this change exists to remove.
  let raised = false;
  step('raise the one decision', () => {
    const key = loginCorrelationKey(runtimeId);
    const open = deps().decisions.list({ status: ['open'] }).find((d) => d.correlationKey === key);
    if (open) return;
    deps().decisions.create({ kind: 'system', id: null }, {
      kind: 'gate_finding', owner: 'human',
      // Not attached to a ticket: the outage is not about one ticket, and attaching it to one would
      // block that ticket alone while every other agent sat silently.
      ticketId: null,
      title: loginDecisionTitle(runtimeId),
      context: loginDecisionContext(runtimeId, detail),
      target: { runtimeId },
      correlationKey: key,
    });
    raised = true;
  });

  // The channel path, deliberately: the conductor may be on this same runtime and unable to take a
  // turn, and an outage must not be able to hide behind an agent the outage itself has stopped.
  if (raised) {
    void deps().threads.notifyHuman({ kind: 'system', id: null }, {
      text: `**${loginDecisionTitle(runtimeId)}**\n\n${loginDecisionContext(runtimeId, detail)}`,
    }).catch((e: unknown) => log.error({ err: String(e), runtimeId }, 'could not tell the human the login expired'));
  }

  log.warn({ runtimeId, agentId: input.agentId ?? null }, 'runtime gated: its login expired');
}

/**
 * Lower the gate for `runtimeId` after its credential has been seen working again. Releases every
 * agent paused for this outage; their wake-ups are still queued, so the next dispatcher tick runs
 * them with nothing re-enqueued. Returns how many agents were released.
 */
export function ungateRuntime(ctx: WorkspaceContext, deps: () => CoreServices, runtimeId: string): number {
  const log = ctx.log('run');
  const step = (name: string, fn: () => void): void => {
    try { fn(); } catch (e) { log.error({ err: String(e), step: name, runtimeId }, `clearing the ${runtimeId} login gate failed at ${name}`); }
  };

  step('clear the credential state', () => { deps().accounts.noteVerified(runtimeId); });

  let released = 0;
  step('release the paused agents', () => {
    const now = nowIso();
    for (const a of agentsOn(ctx, runtimeId)) {
      if (a.status !== 'paused') continue;
      const detail = a.pauseDetail as { code?: string } | null;
      if (detail?.code !== LOGIN_PAUSE_CODE) continue;  // a worker paused for its own reason stays paused
      ctx.db.update('agents', a.id, { status: 'active', pauseReason: null, pauseDetailJson: null, updatedAt: now });
      released += 1;
    }
  });

  step('withdraw the decision', () => {
    const key = loginCorrelationKey(runtimeId);
    for (const d of deps().decisions.list({ status: ['open'] })) {
      if (d.correlationKey === key) deps().decisions.withdraw({ kind: 'system', id: null }, d.id, 'the login was restored');
    }
  });

  if (released > 0) log.info({ runtimeId, released }, 'runtime login restored: paused agents released');
  return released;
}
