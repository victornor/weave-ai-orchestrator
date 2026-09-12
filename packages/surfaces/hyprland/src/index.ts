import { execa } from 'execa';
import type { AgentView, JsonSchema, SurfaceAdapter, SurfaceContext, SurfaceHandle } from '@weave-ai/surface-sdk';
import {
  RULE_KEYWORDS, clientsArgs, closeArgs, execArgs, findClient, focusArgs, layoutMsgArgs, parseClients,
  windowClass, windowRuleArgs, type HyprClient, type RuleKeyword,
} from './commands.js';

export * from './commands.js';

const TIMEOUT_MS = 8000;

export interface HyprlandHandle extends SurfaceHandle { kind: 'hyprland'; agentId: string; cls: string; hyprWorkspace: string | number | null }

const isHyprHandle = (h: SurfaceHandle | undefined): h is HyprlandHandle => !!h && h.kind === 'hyprland' && typeof (h as HyprlandHandle).cls === 'string';

async function hyprctl(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const res = await execa('hyprctl', args, { timeout: TIMEOUT_MS, reject: false });
  const stdout = (res.stdout ?? '').toString();
  const stderr = (res.stderr ?? '').toString();
  // hyprctl exits 0 even for unknown keywords; it answers with "Invalid ..." on stdout.
  const ok = res.exitCode === 0 && !/^invalid|unknown request|couldn't/i.test(stdout.trim());
  return { ok, stdout, stderr };
}

const workspaceOf = (cfg: Record<string, unknown>): string | number | null => {
  const ws = cfg.workspace;
  return typeof ws === 'number' || (typeof ws === 'string' && ws) ? ws : null;
};

export function createHyprlandSurface(): SurfaceAdapter {
  /** Which of the two rule keyword spellings this Hyprland accepts; probed once. */
  let ruleKeyword: RuleKeyword | null = null;

  const applyWindowRule = async (ctx: SurfaceContext, cfg: Record<string, unknown>): Promise<void> => {
    const hyprWorkspace = workspaceOf(cfg);
    if (hyprWorkspace == null) return;
    const candidates: RuleKeyword[] = ruleKeyword ? [ruleKeyword] : [...RULE_KEYWORDS];
    for (const keyword of candidates) {
      const res = await hyprctl(windowRuleArgs(keyword, ctx.workspaceId, hyprWorkspace));
      if (res.ok) {
        ruleKeyword = keyword;
        ctx.log('debug', 'hyprland window rule applied', { keyword, workspace: hyprWorkspace });
        return;
      }
    }
    ruleKeyword = null;
    ctx.log('warn', 'hyprland: neither windowrule nor windowrulev2 was accepted; windows will not be pinned', { workspace: hyprWorkspace });
  };

  const clients = async (): Promise<HyprClient[]> => {
    const res = await hyprctl(clientsArgs());
    return res.ok ? parseClients(res.stdout) : [];
  };

  const spawn = async (ctx: SurfaceContext, cfg: Record<string, unknown>, agentId: string, command: string[]): Promise<HyprlandHandle> => {
    const cls = windowClass(ctx.workspaceId, agentId);
    const hyprWorkspace = workspaceOf(cfg);
    const existing = findClient(await clients(), cls);
    if (existing) return { kind: 'hyprland', agentId, cls, hyprWorkspace };
    const terminal = ctx.terminal();
    if (!terminal) {
      throw new Error(
        'hyprland surface: no terminal emulator resolved. Set presentation.<block>.terminal, export $TERMINAL, or install xdg-terminal-exec.',
      );
    }
    const res = await hyprctl(execArgs({ terminal, cls, command, hyprWorkspace }));
    if (!res.ok) throw new Error(`hyprland: dispatch exec failed for ${agentId}: ${res.stderr.trim() || res.stdout.trim()}`);
    ctx.log('debug', 'hyprland window spawned', { cls, hyprWorkspace, terminal: terminal.cmd });
    return { kind: 'hyprland', agentId, cls, hyprWorkspace };
  };

  return {
    kind: 'hyprland',

    async detect() {
      if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return { available: false, notes: 'HYPRLAND_INSTANCE_SIGNATURE is not set' };
      const res = await execa('hyprctl', ['version'], { timeout: TIMEOUT_MS, reject: false });
      if (res.exitCode !== 0) return { available: false, notes: 'hyprctl not runnable' };
      return { available: true, notes: (res.stdout ?? '').toString().split('\n')[0] };
    },

    configSchema(): JsonSchema {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          surface: { type: 'string' },
          workspace: { type: ['string', 'number'], description: 'Hyprland workspace that worker windows are pinned to' },
          layout: { type: 'string', enum: ['grid', 'per-project'] },
          layoutMsg: { type: 'string', description: 'Optional `hyprctl dispatch layoutmsg` argument used when layout is grid' },
          terminal: { type: 'string' },
          session: { type: 'string' },
          tabPerProject: { type: 'boolean' },
        },
      };
    },

    async ensureAgentView(agent: AgentView, cfg, ctx, _existing) {
      await applyWindowRule(ctx, cfg);
      return spawn(ctx, cfg, agent.agentId, ctx.attachCommand(agent.agentId));
    },

    async ensureConductorView(cfg, ctx) {
      // The weaver deliberately gets no workspace rule: it opens where the human is.
      return spawn(ctx, { ...cfg, workspace: undefined }, 'weaver', ctx.chatCommand());
    },

    /** Titles come from the terminal's OSC title, set by `weave attach`; nothing to push. */
    async updateAgentView() { /* no-op */ },

    async focusAgentView(handle, ctx) {
      if (!isHyprHandle(handle)) return;
      const res = await hyprctl(focusArgs(handle.cls));
      if (!res.ok) ctx.log('debug', 'hyprland focuswindow failed', { cls: handle.cls });
    },

    async closeAgentView(handle, reason, ctx) {
      if (!isHyprHandle(handle)) return;
      const res = await hyprctl(closeArgs(handle.cls));
      ctx.log('debug', res.ok ? 'hyprland window closed' : 'hyprland closewindow failed (already gone?)', { cls: handle.cls, reason });
    },

    async layout(handles, cfg, ctx) {
      // Hyprland tiles by itself; `grid` only optionally nudges the layout.
      if (cfg.layout !== 'grid' || !handles.length) return;
      const msg = typeof cfg.layoutMsg === 'string' ? cfg.layoutMsg : null;
      if (!msg) return;
      const res = await hyprctl(layoutMsgArgs(msg));
      if (!res.ok) ctx.log('debug', 'hyprland layoutmsg failed', { msg });
    },

    async verify(handle) {
      if (!isHyprHandle(handle)) return false;
      return !!findClient(await clients(), handle.cls);
    },
  };
}

export const adapter: SurfaceAdapter = createHyprlandSurface();
export default adapter;

/** Re-apply the runtime window rule (keyword rules do not survive a compositor reload). */
export async function reconcileWindowRules(ctx: SurfaceContext, cfg: Record<string, unknown>): Promise<void> {
  const hyprWorkspace = workspaceOf(cfg);
  if (hyprWorkspace == null) return;
  for (const keyword of RULE_KEYWORDS) {
    const res = await hyprctl(windowRuleArgs(keyword, ctx.workspaceId, hyprWorkspace));
    if (res.ok) return;
  }
  ctx.log('warn', 'hyprland: could not re-apply window rule', { workspace: hyprWorkspace });
}
