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
import { LOGIN_PAUSE_CODE, OcError, type Agent } from '@agent-conductor/shared';
import type { CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { modelSettingFor, modelsFor, workerOptionRuntimes } from '../models/resolve.js';
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

/** One open finding per ticket, whatever fails and however often, while the ticket's worker stays paused for this. */
export const authOutageCorrelationKey = (ticketId: string): string => `auth-outage:${ticketId}`;

export function authOutageTitle(agentName: string): string {
  return `${agentName} is paused: its runtime's login expired`;
}

export function authOutageContext(runtimeId: string, detail: string | null): string {
  return [
    `${runtimeId}'s login expired and could not be refreshed, so this ticket's worker is paused.`,
    detail ? `The runtime said: ${detail}` : null,
    '',
    'This is a fact about the runtime\'s one shared credential, not about this ticket or this worker:',
    'it resumes on its own, on the same ticket, once the login is restored. No action is needed here',
    'unless it keeps failing after several such outages.',
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
  input: { runtimeId: string; agentId?: string | null; agentName?: string | null; runId?: string | null; ticketId?: string | null },
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
          family: 'auth', code: LOGIN_PAUSE_CODE, runtimeId,
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

  // VS-137: the runtime-wide decision above is deliberately not attached to a ticket, so the
  // conductor also gets a per-ticket notice — the same `gate_finding` escalation VS-127 already
  // routes to it — naming exactly which ticket looks stalled and why. One per ticket per outage,
  // the same idiom as the one card above; withdrawn by `finalize` on this ticket's next non-auth turn.
  if (input.ticketId) {
    step('tell the conductor about this ticket', () => {
      const key = authOutageCorrelationKey(input.ticketId!);
      const open = deps().decisions.list({ status: ['open'], ticketId: input.ticketId! }).find((d) => d.correlationKey === key);
      if (open) return;
      deps().decisions.create({ kind: 'system', id: null }, {
        kind: 'gate_finding', owner: 'weaver', ticketId: input.ticketId!,
        title: authOutageTitle(input.agentName ?? 'the worker'),
        context: authOutageContext(runtimeId, detail),
        target: { runtimeId, agentId: input.agentId ?? null },
        correlationKey: key,
      });
    });
  }

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

/** The runtime a login pause was raised for: the detail row, or the reason string on rows gated before `runtimeId` was recorded. */
export function loginPauseRuntime(agent: Agent): string | null {
  const detail = agent.pauseDetail as { runtimeId?: string } | null;
  if (typeof detail?.runtimeId === 'string') return detail.runtimeId;
  const m = new RegExp(`^${LOGIN_PAUSE_CODE}: the (\\S+) login expired$`).exec(agent.pauseReason ?? '');
  return m?.[1] ?? null;
}

/**
 * Release the pauses VS-77 leaves behind when the workspace moves off a dead runtime.
 *
 * A login pause is a fact about the runtime an agent is *about to run on* — `modelSettingFor`
 * decides that at dispatch, not the agent's stamped row. `ungateRuntime` only releases agents still
 * stamped with the gated runtime, so a login that is never coming back (a cancelled subscription, a
 * moved workspace) pauses them forever while the setting already points somewhere healthy.
 *
 * For each login-paused agent: when its next turn's runtime is the one it was paused for, nothing
 * changes (VS-75 stands). When that runtime moved and the new one is healthy, release and restamp —
 * the dispatcher's candidate filter reads `runtime_id` before the engine re-resolves it, so the
 * stamp must not stay on a gated runtime. When the new one is *also* gated, re-target the pause at
 * it rather than releasing into a runtime the dispatcher will skip anyway: the pause then reads as
 * the new gate's own, and `ungateRuntime` on that runtime releases it the honest way. Wake-ups were
 * left queued by the gate, so nothing is re-enqueued here. The gate's card is withdrawn once no
 * setting runs anything on that runtime at all.
 */
export function releaseLoginPausesForAbandonedRuntimes(ctx: WorkspaceContext, deps: () => CoreServices): number {
  const log = ctx.log('daemon');
  const governing = new Set([
    modelSettingFor(modelsFor(ctx), 'weaver').runtime,
    modelSettingFor(modelsFor(ctx), 'worker').runtime,
    ...workerOptionRuntimes(ctx.config, ctx.daemon),
  ]);
  const gated = new Set(deps().accounts.gatedRuntimes());
  let released = 0;
  let repointed = 0;
  for (const a of ctx.db.all<Agent>(
    'SELECT * FROM agents WHERE workspace_id = ? AND status = ? AND retired_at IS NULL',
    [ctx.workspaceId, 'paused'],
  )) {
    const detail = a.pauseDetail as { code?: string; message?: string | null } | null;
    if (detail?.code !== LOGIN_PAUSE_CODE) continue;
    const ticket = a.kind === 'worker' && a.ticketId
      ? ctx.db.get<{ workerModelId: string | null }>('SELECT worker_model_id FROM tickets WHERE id = ?', [a.ticketId])
      : null;
    let target: string;
    try {
      target = modelSettingFor(modelsFor(ctx), a.kind, ticket).runtime;
    } catch (e) {
      if (!(e instanceof OcError) || e.code !== 'model_unconfigured') throw e;
      continue;
    }
    const pausedFor = loginPauseRuntime(a) ?? a.runtimeId;
    if (pausedFor === target) continue;  // the pause still describes the runtime its next turn runs on
    if (gated.has(target)) {
      ctx.db.update('agents', a.id, {
        runtimeId: target, pauseReason: pauseReason(target),
        pauseDetailJson: { family: 'auth', code: LOGIN_PAUSE_CODE, runtimeId: target, message: detail?.message ?? null, resetAt: null, runId: null },
        updatedAt: nowIso(),
      });
      repointed += 1;
      continue;
    }
    ctx.db.update('agents', a.id, {
      status: 'active', runtimeId: target, pauseReason: null, pauseDetailJson: null, updatedAt: nowIso(),
    });
    ctx.events.emit('worker.status', 'agent', a.id, { status: 'active' });
    released += 1;
  }
  // A gated runtime nothing runs on anymore keeps a card that promises work "resumes on its own"
  // — a lie once no agent will ever take a turn on it. Withdraw those; runtimes still governing an
  // agent keep theirs until `ungateRuntime` clears them the honest way.
  for (const runtimeId of gated) {
    if (governing.has(runtimeId)) continue;
    const key = loginCorrelationKey(runtimeId);
    for (const d of deps().decisions.list({ status: ['open'] })) {
      if (d.correlationKey !== key) continue;
      try { deps().decisions.withdraw({ kind: 'system', id: null }, d.id, 'this workspace no longer runs anything on that runtime'); } catch (e) {
        log.error({ err: String(e), decisionId: d.id }, 'could not withdraw an abandoned runtime\'s login card');
      }
    }
  }
  if (released > 0 || repointed > 0) log.info({ governing: [...governing], released, repointed }, 'login pauses reconciled with the workspace\'s runtimes');
  return released;
}
