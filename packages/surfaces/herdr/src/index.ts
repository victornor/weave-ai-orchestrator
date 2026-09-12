import { execa } from 'execa';
import type { AgentPresence, AgentView, JsonSchema, SurfaceAdapter, SurfaceContext, SurfaceHandle } from '@agent-conductor/surface-sdk';
import {
  findPaneForAgent, findTabByLabel, findWorkspaceByLabel, paneCloseArgs, paneLabel, paneListArgs, paneRenameArgs,
  paneRunArgs, paneSplitArgs, parseCreatedPaneId, parseCreatedTabId, parsePaneList, parseTabList, parseWorkspaceList,
  tabCreateArgs, tabFocusArgs, tabListArgs, workspaceCreateArgs, workspaceFocusArgs, workspaceListArgs,
  type HerdrPane,
} from './commands.js';

export * from './commands.js';

const TIMEOUT_MS = 10_000;
const CONDUCTOR_AGENT_ID = 'weaver';

export const STATUS_GLYPHS: Record<string, string> = {
  idle: '○', working: '◑', blocked: '■', 'needs-you': '!', merging: '⇅', done: '✓', failed: '✗', paused: '‖', stalled: '~',
};
export const statusGlyph = (uiStatus: string | undefined): string => (uiStatus && STATUS_GLYPHS[uiStatus]) || '·';

interface EnvAware { env?: Record<string, string> }
const ctxEnv = (ctx: SurfaceContext): Record<string, string> | undefined => (ctx as SurfaceContext & EnvAware).env;

export interface HerdrHandle extends SurfaceHandle {
  kind: 'herdr';
  agentId: string;
  /** Advisory only: herdr compacts ids, so every operation re-resolves by marker. */
  paneId: string | null;
  tabId: string | null;
  herdrWorkspaceId: string | null;
  closedByHuman?: boolean;
}

const isHerdrHandle = (h: SurfaceHandle | undefined): h is HerdrHandle => !!h && h.kind === 'herdr' && typeof (h as HerdrHandle).agentId === 'string';

async function herdr(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const res = await execa('herdr', args, { timeout: TIMEOUT_MS, reject: false });
  return { ok: res.exitCode === 0, stdout: (res.stdout ?? '').toString(), stderr: (res.stderr ?? '').toString() };
}

const workspaceLabel = (ctx: SurfaceContext, cfg: Record<string, unknown>): string =>
  typeof cfg.session === 'string' && cfg.session ? cfg.session : `ac-${ctx.workspaceId}`;

export function createHerdrSurface(): SurfaceAdapter {
  const panes = async (workspaceId?: string): Promise<HerdrPane[]> => {
    const res = await herdr(paneListArgs(workspaceId));
    return res.ok ? parsePaneList(res.stdout) : [];
  };

  const ensureWorkspace = async (ctx: SurfaceContext, cfg: Record<string, unknown>): Promise<{ id: string; created: boolean }> => {
    const label = workspaceLabel(ctx, cfg);
    const listed = await herdr(workspaceListArgs());
    if (!listed.ok) throw new Error(`herdr: workspace list failed: ${listed.stderr.trim()}`);
    const found = findWorkspaceByLabel(parseWorkspaceList(listed.stdout), label);
    if (found) return { id: found.workspaceId, created: false };
    const created = await herdr(workspaceCreateArgs(label, { ...(ctxEnv(ctx) ? { env: ctxEnv(ctx) as Record<string, string> } : {}) }));
    if (!created.ok) throw new Error(`herdr: workspace create failed: ${created.stderr.trim()}`);
    const again = await herdr(workspaceListArgs());
    const resolved = again.ok ? findWorkspaceByLabel(parseWorkspaceList(again.stdout), label) : undefined;
    if (!resolved) throw new Error(`herdr: created workspace ${label} but could not resolve its id`);
    ctx.log('info', 'herdr workspace created', { label, workspaceId: resolved.workspaceId });
    return { id: resolved.workspaceId, created: true };
  };

  const ensureTab = async (ctx: SurfaceContext, herdrWorkspaceId: string, label: string, useFirst: boolean): Promise<string> => {
    const listed = await herdr(tabListArgs(herdrWorkspaceId));
    const tabs = listed.ok ? parseTabList(listed.stdout) : [];
    if (useFirst) {
      const first = tabs[0];
      if (first) return first.tabId;
    } else {
      const found = findTabByLabel(tabs, label);
      if (found) return found.tabId;
    }
    const created = await herdr(tabCreateArgs(herdrWorkspaceId, label, { ...(ctxEnv(ctx) ? { env: ctxEnv(ctx) as Record<string, string> } : {}) }));
    if (!created.ok) throw new Error(`herdr: tab create failed: ${created.stderr.trim()}`);
    const id = parseCreatedTabId(created.stdout);
    if (id) return id;
    const again = await herdr(tabListArgs(herdrWorkspaceId));
    const resolved = again.ok ? findTabByLabel(parseTabList(again.stdout), label) : undefined;
    if (!resolved) throw new Error(`herdr: created tab ${label} but could not resolve its id`);
    return resolved.tabId;
  };

  const rootPaneOfTab = async (herdrWorkspaceId: string, tabId: string): Promise<HerdrPane | undefined> => {
    const all = await panes(herdrWorkspaceId);
    return all.find((p) => p.tabId === tabId);
  };

  const attachPane = async (
    ctx: SurfaceContext, herdrWorkspaceId: string, tabId: string, agentId: string, title: string, command: string[],
  ): Promise<HerdrHandle> => {
    const root = await rootPaneOfTab(herdrWorkspaceId, tabId);
    if (!root) throw new Error(`herdr: tab ${tabId} has no pane to split`);
    const split = await herdr(paneSplitArgs(root.paneId, 'right', { ...(ctxEnv(ctx) ? { env: ctxEnv(ctx) as Record<string, string> } : {}) }));
    if (!split.ok) throw new Error(`herdr: pane split failed for ${agentId}: ${split.stderr.trim()}`);
    let paneId = parseCreatedPaneId(split.stdout);
    if (!paneId) {
      const after = await panes(herdrWorkspaceId);
      paneId = after.filter((p) => p.tabId === tabId).map((p) => p.paneId).pop() ?? null;
    }
    if (!paneId) throw new Error(`herdr: could not resolve the pane created for ${agentId}`);
    const run = await herdr(paneRunArgs(paneId, command));
    if (!run.ok) ctx.log('warn', 'herdr pane run failed', { paneId, agentId, stderr: run.stderr.trim() });
    await herdr(paneRenameArgs(paneId, paneLabel(agentId, title)));
    ctx.log('debug', 'herdr pane created', { paneId, tabId, agentId });
    return { kind: 'herdr', agentId, paneId, tabId, herdrWorkspaceId };
  };

  return {
    kind: 'herdr',

    async detect() {
      if (process.env.HERDR_ENV === '1') return { available: true, notes: 'running inside herdr' };
      const res = await execa('herdr', workspaceListArgs(), { timeout: TIMEOUT_MS, reject: false });
      if (res.exitCode === 0) return { available: true, notes: 'herdr socket reachable' };
      return { available: false, notes: 'herdr not running (workspace list failed)' };
    },

    configSchema(): JsonSchema {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          surface: { type: 'string' },
          session: { type: 'string', description: 'herdr workspace label (default ac-<workspaceId>)' },
          tabPerProject: { type: 'boolean', default: true },
          layout: { type: 'string', enum: ['grid', 'per-project'] },
          terminal: { type: 'string' },
          workspace: { type: ['string', 'number'] },
          reconcile: { type: 'boolean', description: 'Recreate panes the human closed (set by `conductor presentation reconcile`)' },
        },
      };
    },

    async ensureAgentView(agent: AgentView, cfg, ctx, existing) {
      const ws = await ensureWorkspace(ctx, cfg);
      const existingPane = findPaneForAgent(await panes(ws.id), agent.agentId, ws.id);
      if (existingPane) {
        return { kind: 'herdr', agentId: agent.agentId, paneId: existingPane.paneId, tabId: existingPane.tabId, herdrWorkspaceId: ws.id } satisfies HerdrHandle;
      }
      if (isHerdrHandle(existing) && cfg.reconcile !== true) {
        // The human closed this pane; do not fight it (recreated on explicit reconcile).
        ctx.log('debug', 'herdr pane for agent is gone; leaving it closed', { agentId: agent.agentId });
        return { ...existing, paneId: null, closedByHuman: true } satisfies HerdrHandle;
      }
      const tabLabel = cfg.tabPerProject === false ? 'workers' : agent.projectId ?? 'workers';
      const tabId = await ensureTab(ctx, ws.id, tabLabel, false);
      const title = `${statusGlyph(agent.uiStatus)} ${agent.ticketIdentifier ?? agent.roleName ?? agent.name}`;
      return attachPane(ctx, ws.id, tabId, agent.agentId, title, ctx.attachCommand(agent.agentId));
    },

    async ensureConductorView(cfg, ctx) {
      const ws = await ensureWorkspace(ctx, cfg);
      const existingPane = findPaneForAgent(await panes(ws.id), CONDUCTOR_AGENT_ID, ws.id);
      if (existingPane) {
        return { kind: 'herdr', agentId: CONDUCTOR_AGENT_ID, paneId: existingPane.paneId, tabId: existingPane.tabId, herdrWorkspaceId: ws.id } satisfies HerdrHandle;
      }
      const tabId = await ensureTab(ctx, ws.id, 'weaver', ws.created);
      const root = await rootPaneOfTab(ws.id, tabId);
      if (!root) throw new Error('herdr: weaver tab has no root pane');
      const run = await herdr(paneRunArgs(root.paneId, ctx.chatCommand()));
      if (!run.ok) ctx.log('warn', 'herdr pane run failed for the weaver', { paneId: root.paneId, stderr: run.stderr.trim() });
      await herdr(paneRenameArgs(root.paneId, paneLabel(CONDUCTOR_AGENT_ID, 'weaver')));
      return { kind: 'herdr', agentId: CONDUCTOR_AGENT_ID, paneId: root.paneId, tabId, herdrWorkspaceId: ws.id } satisfies HerdrHandle;
    },

    async updateAgentView(handle, state: AgentPresence, ctx) {
      if (!isHerdrHandle(handle)) return;
      const pane = findPaneForAgent(await panes(handle.herdrWorkspaceId ?? undefined), handle.agentId, handle.herdrWorkspaceId ?? undefined);
      if (!pane) return;
      const res = await herdr(paneRenameArgs(pane.paneId, paneLabel(handle.agentId, `${statusGlyph(state.uiStatus)} ${state.title}`)));
      if (!res.ok) ctx.log('debug', 'herdr pane rename failed', { paneId: pane.paneId });
    },

    async focusAgentView(handle, ctx) {
      if (!isHerdrHandle(handle)) return;
      const pane = findPaneForAgent(await panes(handle.herdrWorkspaceId ?? undefined), handle.agentId, handle.herdrWorkspaceId ?? undefined);
      if (!pane) return;
      await herdr(workspaceFocusArgs(pane.workspaceId));
      const res = await herdr(tabFocusArgs(pane.tabId));
      if (!res.ok) ctx.log('debug', 'herdr tab focus failed', { tabId: pane.tabId });
    },

    async closeAgentView(handle, reason, ctx) {
      if (!isHerdrHandle(handle)) return;
      const pane = findPaneForAgent(await panes(handle.herdrWorkspaceId ?? undefined), handle.agentId, handle.herdrWorkspaceId ?? undefined);
      if (!pane) return;
      const res = await herdr(paneCloseArgs(pane.paneId));
      ctx.log('debug', res.ok ? 'herdr pane closed' : 'herdr pane close failed', { paneId: pane.paneId, reason });
    },

    /** herdr owns its own splits; nothing to arrange. */
    async layout() { /* no-op */ },

    async verify(handle) {
      if (!isHerdrHandle(handle)) return false;
      return !!findPaneForAgent(await panes(handle.herdrWorkspaceId ?? undefined), handle.agentId, handle.herdrWorkspaceId ?? undefined);
    },
  };
}

export const adapter: SurfaceAdapter = createHerdrSurface();
export default adapter;
