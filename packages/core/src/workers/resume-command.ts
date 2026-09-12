/**
 * VS-249: the one paste-ready command a human's own terminal needs to resume a worker's session —
 * `session-handover/command`. Built entirely from pure functions (`RuntimeAdapter.resumeCommand`,
 * `launchCommand`) and never spawns anything; safe to call on every read of a worker or a decision
 * raised for one, not only when a human explicitly asks for it.
 */
import { join } from 'node:path';
import { daemonEnv, launchCommand, pinHostMiseRoots } from '@weave-ai/runtime-sdk';
import type { Agent } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';
import type { SessionRow } from '../sessions/index.js';

export interface HandoverCommand {
  resumable: true;
  runtime: string;
  /** One shell line: `cd <home> && <OVERLAY_VAR>=<val> ... <resolved-bin> <args...>`. */
  command: string;
  /** Plain-language statement of where the command lands vs. where the checkout is. */
  landingLine: string;
}
export interface HandoverUnresumable {
  resumable: false;
  runtime: string;
  /** Why no command is offered — an unresumable runtime, or no session to resume yet. */
  reason: string;
}
export type HandoverCommandResult = HandoverCommand | HandoverUnresumable;

/** Single-quotes `s` for a POSIX shell, escaping any embedded single quote. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * `model` is the effective model the worker's next turn would run with (the same resolution
 * `resume()`/the dispatcher already use) — passed in rather than re-resolved here, so this module
 * stays free of the model-settings machinery.
 */
export function buildHandoverCommand(ctx: WorkspaceContext, agent: Agent, session: SessionRow | null, model: string | null): HandoverCommandResult {
  const runtime = agent.runtimeId;
  const adapter = ctx.registries.runtimes.get(runtime);
  if (!adapter || !adapter.capabilities.resumableSessions || !adapter.resumeCommand) {
    return { resumable: false, runtime, reason: `${adapter?.displayName ?? runtime} cannot resume a session outside the daemon.` };
  }
  if (!session || !session.sessionRef) {
    return { resumable: false, runtime, reason: 'There is no session to resume yet — this worker has not completed a turn.' };
  }

  const configHome = join(ctx.paths.runtimesHome, runtime);
  const built = adapter.resumeCommand({ cwd: agent.homePath, worktreePath: agent.worktreePath, session: session.sessionRef, configHome, model });

  // Only a runtime whose overlay relocates HOME/XDG_* (OpenCode) needs the mise pin — checking
  // membership first, not equality, because an adapter that never sets these keys must not be
  // treated as "relocated to undefined" by pinHostMiseRoots' own equality check.
  if ('HOME' in built.env || 'XDG_DATA_HOME' in built.env || 'XDG_CONFIG_HOME' in built.env) {
    pinHostMiseRoots(built.env, daemonEnv());
  }

  // The same binary resolution a daemon-run turn would use (daemon's own PATH + fallback dirs) —
  // an absolute path once resolved works from any shell on this host, so the human's own PATH
  // never has to agree with the daemon's for this to work.
  const launch = launchCommand(built.cmd, {});
  const overlay = Object.entries(built.env).map(([k, v]) => `${k}=${shq(v)}`).join(' ');
  const argv = [launch.cmd, ...built.args].map(shq).join(' ');
  const command = `cd ${shq(agent.homePath)} && ${overlay.length > 0 ? `${overlay} ` : ''}${argv}`;

  const landingLine = agent.worktreePath && agent.worktreePath !== agent.homePath
    ? `Lands in the worker's home directory (${agent.homePath}); the checkout is at ${agent.worktreePath}, already reachable from this session.`
    : `Lands in the worker's home directory (${agent.homePath}), which is also its checkout.`;

  return { resumable: true, runtime, command, landingLine };
}
