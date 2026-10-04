import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import type { RuntimeAdapter, RuntimeModel, TurnResult } from '@weave-ai/runtime-sdk';
import { runState, type Registries } from '@weave-ai/core';
import { DEMO_NOW_MS } from './clock.js';
import { scriptFor } from './script.js';
import type { WorkspaceRuntime } from '../types.js';

/**
 * VS-770: a runtime that only pretends. It is the only runtime a demo daemon registers, so no coding
 * CLI is ever detected, probed or launched; `runTurn` would replay a scripted turn, but a demo never
 * dispatches one (the dispatcher is not started), so it exists to satisfy the registry's contract.
 */
function demoRuntime(id: string, displayName: string, models: RuntimeModel[]): RuntimeAdapter {
  return {
    id, displayName,
    capabilities: {
      resumableSessions: true, forkSessions: false, streamingInput: true, systemPromptInjection: 'system_prompt', structuredOutput: true,
      mcp: true, usageReporting: 'per_turn', costReporting: true, permissionModes: ['auto', 'restricted', 'bypass'], partialOutput: 'text', imageInput: 'native',
    },
    async detect() { return { status: 'available' as const, version: 'demo' }; },
    async listModels() { return models; },
    configSchema() { return { type: 'object', properties: {} }; },
    async installInstructions() { /* nothing to install */ },
    skillsDir() { return `.${id}/skills`; },
    instructionFiles() { return ['AGENTS.md']; },
    async runTurn(_input, sink): Promise<TurnResult> {
      sink.onSpawn({ pid: process.pid, pgid: null });
      return { exitCode: 0, signal: null, timedOut: false, session: { sessionId: 'demo' }, finalText: JSON.stringify({ state: 'idle', summary: 'demo', tickets: [] }) };
    },
  };
}

/** A forge that has no network: every pull request it is asked about is open, green and mergeable. */
function demoForge(): ForgeAdapter {
  return {
    id: 'github',
    detect: async () => true,
    prState: async () => ({ state: 'open', ciState: 'success', checks: { passed: 6, total: 6 }, checkDetails: [], mergeState: 'clean', isDraft: false }),
    mergePr: async () => ({}),
    hasCiWorkflows: async () => true,
    repoInfo: async () => ({ private: true }),
    runnerStatus: async () => ({ onlineLabels: ['self-hosted', 'linux'] }),
  };
}

export function registerDemoAdapters(registries: Registries): void {
  registries.runtimes.set('claude', demoRuntime('claude', 'Claude Code', [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', provider: 'anthropic', source: 'static', tier: 'deep', contextWindowTokens: 1_000_000, efforts: ['low', 'medium', 'high'] },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', provider: 'anthropic', source: 'static', tier: 'standard', contextWindowTokens: 1_000_000, efforts: ['low', 'medium', 'high'] },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', provider: 'anthropic', source: 'static', tier: 'fast', contextWindowTokens: 200_000, efforts: [] },
  ]));
  registries.runtimes.set('codex', demoRuntime('codex', 'Codex', [
    { id: 'gpt-codex-demo', label: 'Codex', provider: 'openai', source: 'static', tier: 'standard', contextWindowTokens: 400_000, efforts: ['low', 'medium', 'high'] },
  ]));
  registries.forges.set('github', demoForge());
}

const TICK_MS = 1_500;

/**
 * VS-770: the scripted live progress. Each tick appends the next scripted event to every run the seed
 * left `running` — persisted, so a page opened mid-run reads it, and broadcast as the live `run.event`
 * frame a watching page follows. Timestamps count up from the demo's fixed "now" so they never depend
 * on the wall clock.
 */
export function startDemoPlayer(workspaces: Map<string, WorkspaceRuntime>): { stop(): void } {
  const cursors = new Map<string, number>();
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    for (const ws of new Set(workspaces.values())) {
      let running: Array<{ id: string; kind: string; agentId: string; projectSlug: string | null; ticketKind: string | null }> = [];
      try {
        running = ws.ctx.db.all<{ id: string; kind: string; agentId: string; projectSlug: string | null; ticketKind: string | null }>(
          `SELECT r.id AS id, a.kind AS kind, a.id AS agent_id, p.slug AS project_slug, t.kind AS ticket_kind
             FROM runs r JOIN agents a ON a.id = r.agent_id LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN tickets t ON t.id = r.ticket_id
            WHERE r.status = 'running' ORDER BY r.id`,
        );
      } catch { continue; }
      for (const run of running) {
        // A run the engine would be executing: the pages that ask "is a turn running?" read this map.
        const active = runState(ws.ctx).active;
        if (!active.has(run.id)) active.set(run.id, { runId: run.id, agentId: run.agentId, startedAt: DEMO_NOW_MS, pid: null, cancel: async () => undefined, send: async () => 'delivered' });
        const script = scriptFor(run.kind, run.projectSlug, run.ticketKind);
        // Continue from where the persisted history stops, so the first tick follows the last seeded event.
        const at = cursors.get(run.id) ?? (ws.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM run_events WHERE run_id = ?', [run.id])?.n ?? 0);
        cursors.set(run.id, at + 1);
        const ev = script[at % script.length]!;
        const ts = new Date(DEMO_NOW_MS + ticks * TICK_MS).toISOString();
        try {
          const seq = (ws.ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(seq),0) n FROM run_events WHERE run_id = ?', [run.id])?.n ?? 0) + 1;
          const stream = ev.stream ?? 'runtime';
          ws.ctx.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)', [run.id, seq, ts, ev.type, stream, 'info', JSON.stringify(ev.payload)]);
          ws.ctx.events.broadcast('run.event', 'run', run.id, { runId: run.id, event: { id: String(seq), runId: run.id, seq, ts, type: ev.type, stream, level: 'info', payload: ev.payload } });
        } catch { /* a stopping daemon may have closed the database */ }
      }
    }
  }, TICK_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
