import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeRuntime, type ResumeCommand, type ResumeCommandInput } from '@weave-ai/runtime-sdk';
import type { Agent } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import type { SessionRow } from '../sessions/index.js';
import { buildHandoverCommand } from './resume-command.js';

/**
 * Stands in for OpenCode without importing a runtime package into `packages/core` (boundary rule):
 * relocates HOME/XDG_* to `configHome`, the one shape that must trigger the daemon's own mise pin.
 */
class RelocatingFakeRuntime extends FakeRuntime {
  override resumeCommand(input: ResumeCommandInput): ResumeCommand {
    return { cmd: 'fake', args: ['-s', 'ses_1'], env: input.configHome ? { HOME: input.configHome, XDG_CONFIG_HOME: input.configHome, XDG_DATA_HOME: input.configHome } : {} };
  }
}

function agent(h: TestHarness, over: Partial<Agent> = {}): Agent {
  return {
    id: 'a1', workspaceId: h.workspaceId, kind: 'worker', projectId: null, roleId: null, roleRevision: null,
    ticketId: null, planId: null, name: 'Backend Engineer #1', runtimeId: 'claude', status: 'active', pauseReason: null,
    pauseDetail: null, errorText: null, homePath: join(h.ctx.paths.workers, 'a1'),
    worktreePath: join(h.ctx.paths.workers, 'a1', 'work'), branch: 'ac/tst-1', workerModelId: null, turnEpoch: 1, turnCount: 1,
    spawnedBy: 'system', spawnReason: null, briefRevision: 1, lastRunAt: null, retiredAt: null,
    createdAt: 't0', updatedAt: 't0', ...over,
  };
}

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1', agentId: 'a1', runtimeId: 'claude', sessionRef: { sessionId: 'sess-1' }, displayId: null,
    status: 'active', turnCount: 1, lastRunId: null, lastError: null, cumulativeUsage: null,
    createdAt: 't0', updatedAt: 't0', ...over,
  };
}

describe('buildHandoverCommand (VS-249)', () => {
  let h: TestHarness;

  it('builds a single-line, quoted command for a resumable runtime with a session', () => {
    h = makeHarness();
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    const result = buildHandoverCommand(h.ctx, agent(h), session(), null);
    expect(result.resumable).toBe(true);
    if (!result.resumable) throw new Error('expected resumable');
    expect(result.command).not.toContain('\n');
    expect(result.command).toContain(`cd '${join(h.ctx.paths.workers, 'a1')}'`);
    expect(result.command).toContain('--resume');
    expect(result.command).toContain('sess-1');
    expect(result.landingLine).toContain(join(h.ctx.paths.workers, 'a1', 'work'));
    h.cleanup();
  });

  it('sets FAKE_CONFIG_DIR inline, scoped to the runtimesHome for this runtime', () => {
    h = makeHarness();
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    const result = buildHandoverCommand(h.ctx, agent(h), session(), null);
    if (!result.resumable) throw new Error('expected resumable');
    expect(result.command).toContain(`FAKE_CONFIG_DIR='${join(h.ctx.paths.runtimesHome, 'claude')}'`);
    h.cleanup();
  });

  it('quotes a worktree path containing a space safely', () => {
    h = makeHarness();
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    const spaced = agent(h, { homePath: join(h.ctx.paths.workers, 'has space'), worktreePath: join(h.ctx.paths.workers, 'has space', 'work') });
    const result = buildHandoverCommand(h.ctx, spaced, session(), null);
    if (!result.resumable) throw new Error('expected resumable');
    expect(result.command).toContain(`cd '${join(h.ctx.paths.workers, 'has space')}'`);
    h.cleanup();
  });

  it('says why, and offers no command, when the runtime cannot resume a session', () => {
    h = makeHarness();
    const rt = new FakeRuntime();
    rt.resumableSessions = false;
    h.ctx.registries.runtimes.set('claude', rt);
    const result = buildHandoverCommand(h.ctx, agent(h), session(), null);
    expect(result.resumable).toBe(false);
    if (result.resumable) throw new Error('expected unresumable');
    expect(result.reason).toMatch(/cannot resume/i);
    h.cleanup();
  });

  it('says why, and offers no command, when the runtime has no interactive resume form', () => {
    h = makeHarness();
    const rt = new FakeRuntime();
    (rt as unknown as { resumeCommand?: unknown }).resumeCommand = undefined;
    h.ctx.registries.runtimes.set('claude', rt);
    const result = buildHandoverCommand(h.ctx, agent(h), session(), null);
    expect(result.resumable).toBe(false);
    if (result.resumable) throw new Error('expected unresumable');
    expect(result.reason).toMatch(/cannot resume/i);
    h.cleanup();
  });

  it('pins MISE_* back to the daemon roots when the runtime relocates HOME (OpenCode shape)', () => {
    h = makeHarness();
    h.ctx.registries.runtimes.set('opencode', new RelocatingFakeRuntime());
    process.env['MISE_DATA_DIR'] = '/real/mise/data';
    process.env['MISE_CONFIG_DIR'] = '/real/mise/config';
    process.env['MISE_CACHE_DIR'] = '/real/mise/cache';
    try {
      const result = buildHandoverCommand(h.ctx, agent(h, { runtimeId: 'opencode' }), session(), null);
      if (!result.resumable) throw new Error('expected resumable');
      expect(result.command).toContain("MISE_DATA_DIR='/real/mise/data'");
      expect(result.command).toContain("MISE_CONFIG_DIR='/real/mise/config'");
      expect(result.command).toContain("MISE_CACHE_DIR='/real/mise/cache'");
    } finally {
      delete process.env['MISE_DATA_DIR'];
      delete process.env['MISE_CONFIG_DIR'];
      delete process.env['MISE_CACHE_DIR'];
      h.cleanup();
    }
  });

  it('does not pin MISE_* for a runtime that never relocates HOME', () => {
    h = makeHarness();
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    const result = buildHandoverCommand(h.ctx, agent(h), session(), null);
    if (!result.resumable) throw new Error('expected resumable');
    expect(result.command).not.toContain('MISE_');
    h.cleanup();
  });

  it('says why, and offers no command, when there is no session yet', () => {
    h = makeHarness();
    h.ctx.registries.runtimes.set('claude', new FakeRuntime());
    const result = buildHandoverCommand(h.ctx, agent(h), null, null);
    expect(result.resumable).toBe(false);
    if (result.resumable) throw new Error('expected unresumable');
    expect(result.reason).toMatch(/no session/i);
    h.cleanup();
  });
});
