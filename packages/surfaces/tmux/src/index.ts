import { execa } from 'execa';
import type { AgentPresence, AgentView, JsonSchema, SurfaceAdapter, SurfaceContext, SurfaceHandle } from '@openconductor/surface-sdk';
import {
  CONDUCTOR_AGENT_ID, CONDUCTOR_WINDOW_NAME, findWindow, hasSessionArgs, killWindowArgs, listWindowsArgs,
  newSessionArgs, newWindowArgs, parseListWindows, renameWindowArgs, selectLayoutArgs, selectWindowArgs,
  sessionName, setAgentOptionArgs, statusGlyph, windowName, type TmuxWindow,
} from './commands.js';

export * from './commands.js';

const TIMEOUT_MS = 8000;

/** The presenter may attach an env bag for spawned windows; SurfaceContext itself has no env slot. */
interface EnvAware { env?: Record<string, string> }
const ctxEnv = (ctx: SurfaceContext): Record<string, string> | undefined => (ctx as SurfaceContext & EnvAware).env;

export interface TmuxHandle extends SurfaceHandle { kind: 'tmux'; session: string; windowId: string; agentId: string }

const isTmuxHandle = (h: SurfaceHandle | undefined): h is TmuxHandle =>
  !!h && h.kind === 'tmux' && typeof (h as TmuxHandle).windowId === 'string' && typeof (h as TmuxHandle).session === 'string';

async function tmux(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const res = await execa('tmux', args, { timeout: TIMEOUT_MS, reject: false });
  return { ok: res.exitCode === 0, stdout: (res.stdout ?? '').toString(), stderr: (res.stderr ?? '').toString() };
}

async function listWindows(session: string): Promise<TmuxWindow[]> {
  const res = await tmux(listWindowsArgs(session));
  return res.ok ? parseListWindows(res.stdout) : [];
}

export function createTmuxSurface(): SurfaceAdapter {
  // Concurrent ensure* calls share one in-flight session creation per session name (tmux rejects duplicate sessions).
  const inflight = new Map<string, Promise<string>>();
  const ensureSession = (ctx: SurfaceContext, cfg: Record<string, unknown>): Promise<string> => {
    const session = typeof cfg.session === 'string' && cfg.session ? cfg.session : sessionName(ctx.workspaceId);
    const pending = inflight.get(session);
    if (pending) return pending;
    const p = (async () => {
      const has = await tmux(hasSessionArgs(session));
      if (has.ok) return session;
      const created = await tmux(newSessionArgs(session, CONDUCTOR_WINDOW_NAME, ctx.chatCommand(), ctxEnv(ctx)));
      if (!created.ok) {
        if (/duplicate session/.test(created.stderr)) return session;
        throw new Error(`tmux: could not create session ${session}: ${created.stderr.trim()}`);
      }
      // Keep panes open after their command exits so a failed `oc attach` stays readable instead of collapsing the session.
      await tmux(['set-option', '-t', session, 'remain-on-exit', 'on']);
      const windows = await listWindows(session);
      const first = windows[0];
      if (first) await tmux(setAgentOptionArgs(first.windowId, CONDUCTOR_AGENT_ID));
      ctx.log('info', 'tmux session created', { session });
      return session;
    })().finally(() => inflight.delete(session));
    inflight.set(session, p);
    return p;
  };

  const ensureWindow = async (
    ctx: SurfaceContext, cfg: Record<string, unknown>, agentId: string, name: string, command: string[], existing?: SurfaceHandle,
  ): Promise<TmuxHandle> => {
    const session = await ensureSession(ctx, cfg);
    const windows = await listWindows(session);
    const known = isTmuxHandle(existing) && existing.session === session ? existing.windowId : undefined;
    const found = findWindow(windows, agentId, known);
    if (found) {
      if (found.name !== name) await tmux(renameWindowArgs(found.windowId, name));
      if (found.agentId !== agentId) await tmux(setAgentOptionArgs(found.windowId, agentId));
      return { kind: 'tmux', session, windowId: found.windowId, agentId };
    }
    const created = await tmux(newWindowArgs(session, name, command, ctxEnv(ctx)));
    if (!created.ok) throw new Error(`tmux: could not create window for ${agentId}: ${created.stderr.trim()}`);
    const windowId = created.stdout.trim().split('\n').pop() ?? '';
    if (!windowId.startsWith('@')) throw new Error(`tmux: unexpected window id "${windowId}" for ${agentId}`);
    await tmux(setAgentOptionArgs(windowId, agentId));
    ctx.log('debug', 'tmux window created', { session, windowId, agentId });
    return { kind: 'tmux', session, windowId, agentId };
  };

  return {
    kind: 'tmux',

    async detect() {
      const res = await execa('tmux', ['-V'], { timeout: TIMEOUT_MS, reject: false });
      if (res.exitCode === 0) return { available: true, notes: (res.stdout ?? '').toString().trim() };
      return { available: false, notes: 'tmux binary not found or not runnable' };
    },

    configSchema(): JsonSchema {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          surface: { type: 'string' },
          session: { type: 'string', description: 'Override the session name (default oc-<workspaceId>)' },
          layout: { type: 'string', enum: ['grid', 'per-project'] },
          terminal: { type: 'string' },
          workspace: { type: ['string', 'number'] },
          tabPerProject: { type: 'boolean' },
        },
      };
    },

    async ensureAgentView(agent: AgentView, cfg, ctx, existing) {
      const name = windowName(agent, agent.uiStatus);
      return ensureWindow(ctx, cfg, agent.agentId, name, ctx.attachCommand(agent.agentId), existing);
    },

    async ensureConductorView(cfg, ctx) {
      const session = await ensureSession(ctx, cfg);
      const windows = await listWindows(session);
      const found = findWindow(windows, CONDUCTOR_AGENT_ID);
      if (found) return { kind: 'tmux', session, windowId: found.windowId, agentId: CONDUCTOR_AGENT_ID } satisfies TmuxHandle;
      return ensureWindow(ctx, cfg, CONDUCTOR_AGENT_ID, CONDUCTOR_WINDOW_NAME, ctx.chatCommand());
    },

    async updateAgentView(handle, state: AgentPresence, ctx) {
      if (!isTmuxHandle(handle)) return;
      const label = `${statusGlyph(state.uiStatus)} ${state.title}`.slice(0, 40).replace(/[:.]/g, '-');
      const res = await tmux(renameWindowArgs(handle.windowId, label));
      if (!res.ok) ctx.log('debug', 'tmux rename-window failed (window gone?)', { windowId: handle.windowId });
    },

    async focusAgentView(handle, ctx) {
      if (!isTmuxHandle(handle)) return;
      const res = await tmux(selectWindowArgs(handle.windowId));
      if (!res.ok) ctx.log('debug', 'tmux select-window failed', { windowId: handle.windowId });
    },

    async closeAgentView(handle, reason, ctx) {
      if (!isTmuxHandle(handle)) return;
      const res = await tmux(killWindowArgs(handle.windowId));
      ctx.log('debug', res.ok ? 'tmux window closed' : 'tmux kill-window failed (already closed?)', { windowId: handle.windowId, reason });
    },

    async layout(handles, cfg, _ctx) {
      if (cfg.layout !== 'grid') return;
      for (const h of handles) if (isTmuxHandle(h)) await tmux(selectLayoutArgs(h.windowId));
    },

    async verify(handle, _ctx) {
      if (!isTmuxHandle(handle)) return false;
      const windows = await listWindows(handle.session);
      return windows.some((w) => w.windowId === handle.windowId || w.agentId === handle.agentId);
    },
  };
}

export const adapter: SurfaceAdapter = createTmuxSurface();
export default adapter;
