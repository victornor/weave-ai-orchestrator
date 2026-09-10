import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import type { Agent, RoleSpec } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { buildTurnPrompt, humanName, renderBrief, renderCharter, renderConductorInstructions, renderWorkerInstructions } from './index.js';

const SHIPPED_TEMPLATES = fileURLToPath(new URL('../../../../templates', import.meta.url));

const spec: RoleSpec = {
  id: 'api-backend', name: 'Backend Engineer', project: 'api', charterSummary: 'Owns the api service.',
  scope: 'Backend work in the api repo.', responsibilities: ['Implement handlers'], capabilities: ['node'],
  exclusions: ['frontend'], rules: ['Run the tests'], runtime: 'claude', model: null, sessionPolicy: 'per_ticket',
  maxWorkers: 2, permission: { mode: 'auto', allowed: [], denied: [] }, secrets: [], createdBy: 'conductor',
} as RoleSpec;

describe('prompt rendering', () => {
  let h: TestHarness;
  let worker: Agent;
  let ticketId: string;

  beforeEach(() => {
    h = makeHarness({ config: { conductor: { runtime: 'claude', model: null, channels: ['web'], humanName: 'Victor' } as never } });
    ticketId = newId();
    const now = nowIso();
    h.db.insert('tickets', {
      id: ticketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 42, identifier: 'TST-42', kind: 'change',
      title: 'Add dark mode', description: 'Make it dark.\n\n## Acceptance criteria\n- toggle works\n- respects the OS setting',
      status: 'approved', priority: 'high', assigneeRoleId: h.roleId, createdByKind: 'agent',
      openspecChangeName: 'tst-42-add-dark-mode', createdAt: now, updatedAt: now,
    });
    const workerId = h.addWorker(ticketId, { branch: 'ac/tst-42-add-dark-mode', worktreePath: null });
    worker = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [workerId])!;
    h.services.roles = { charter: () => '## Charter\n\nOwns the api service.' } as never;
    h.services.knowledge = { get: (scope: string) => ({ body: `KB:${scope}` }), bootstrapDigest: () => ({ text: 'SHARED.md + PROJECT.md digest', tokens: 12, truncated: false }) } as never;
  });
  afterEach(() => h.cleanup());

  it('addresses the human by the configured name, else captain', () => {
    expect(humanName(h.ctx)).toBe('Victor');
    h.ctx.config = { ...h.ctx.config, conductor: { ...h.ctx.config.conductor, humanName: undefined } };
    expect(humanName(h.ctx)).toBe('captain');
  });

  it('renders the worker instructions as charter plus brief with the built-in fallback templates', () => {
    const out = renderWorkerInstructions(h.ctx, h.deps, worker);
    expect(out).toContain('Backend Engineer #1');
    expect(out).toContain('Owns the api service.');
    expect(out).toContain('TST-42 — Add dark mode');
    expect(out).toContain('- toggle works');
    expect(out).toContain('tst-42-add-dark-mode');
    expect(out).toContain('KB:shared');
    expect(out).toContain('KB:project');
    expect(out).not.toMatch(/\{\{|\}\}/);
  });

  it('includes the relaunch note in the brief when one is given', () => {
    expect(renderBrief(h.ctx, h.deps, worker, { relaunchNote: 'you stopped responding' })).toContain('you stopped responding');
  });

  it('renders the conductor instructions with the live portfolio', () => {
    const out = renderConductorInstructions(h.ctx, h.deps);
    expect(out).toContain('Test Workspace');
    expect(out).toContain('`api`');
    expect(out).toContain('Backend Engineer');
    expect(out).not.toMatch(/\{\{|\}\}/);
  });

  describe('YOLO mode in the instructions', () => {
    const brief = (): string => renderBrief(h.ctx, h.deps, worker);
    const shipped = (): TestHarness['ctx'] => Object.assign(h.ctx, { templatesDir: SHIPPED_TEMPLATES });

    it('tells a worker its approvals are granted for it when the mode is on', () => {
      h.ctx.config.defaults.yolo = true;
      expect(brief()).toContain('YOLO mode is on for this project');
      shipped();
      expect(brief()).toContain('YOLO mode is on for this project');
      expect(brief()).not.toMatch(/\{\{|\}\}/);
    });

    it('tells a worker the approvals are the human\'s when the mode is off', () => {
      expect(h.ctx.config.defaults.yolo).toBe(false);
      expect(brief()).toContain('are the human\'s');
      expect(brief()).not.toContain('YOLO mode is on');
      shipped();
      expect(brief()).toContain('Plan approval and merge approval are the human\'s');
      expect(brief()).not.toContain('YOLO mode is on');
    });

    it('follows the project override rather than the workspace default', () => {
      h.ctx.config.defaults.yolo = true;
      h.db.update('projects', h.projectId, { policiesJson: { yolo: false } });
      expect(brief()).not.toContain('YOLO mode is on');

      h.ctx.config.defaults.yolo = false;
      h.db.update('projects', h.projectId, { policiesJson: { yolo: true } });
      expect(brief()).toContain('YOLO mode is on for this project');
    });

    it('states the policy in the conductor instructions, both ways', () => {
      expect(renderConductorInstructions(h.ctx, h.deps)).toContain('Merge approval is always');
      h.ctx.config.defaults.yolo = true;
      const on = renderConductorInstructions(h.ctx, h.deps);
      expect(on).toContain('YOLO mode is on');
      expect(on).not.toMatch(/\{\{|\}\}/);

      shipped();
      const shippedOn = renderConductorInstructions(h.ctx, h.deps);
      expect(shippedOn).toContain('YOLO mode is on for this workspace');
      expect(shippedOn).not.toMatch(/\{\{|\}\}/);
    });
  });

  it('renders a charter from a spec', () => {
    const charter = renderCharter(h.ctx, spec);
    expect(charter).toContain('Backend Engineer');
    expect(charter).toContain('Implement handlers');
    expect(charter).toContain('frontend');
    expect(charter).not.toMatch(/\{\{|\}\}/);
  });

  it('builds a turn prompt with wakes, ticket, answered decisions and notes', async () => {
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'decision_answered', reason: 'plan approved', payload: { bundle: [{ source: 'ticket_comment', reason: 'human asked about spacing' }] }, status: 'claimed' } as never;
    h.db.insert('decisions', {
      id: 'd1', workspaceId: h.workspaceId, ticketId, kind: 'plan_approval', owner: 'human', title: 'Approve the dark mode plan?',
      context: '', optionsJson: [], allowFreeText: 1, status: 'answered', answerKey: 'approve', answerText: 'yes, use CSS variables',
      askedByAgentId: worker.id, answeredAt: nowIso(), createdAt: nowIso(),
    });

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], { isFirstTurn: true, briefUpdated: true, relaunchNote: 'picked up after a crash' });
    expect(prompt).toContain('# Turn 1 for Backend Engineer #1 (worker)');
    expect(prompt).toContain('decision_answered: plan approved');
    expect(prompt).toContain('ticket_comment: human asked about spacing');
    expect(prompt).toContain('TST-42 [approved] Add dark mode');
    expect(prompt).toContain('yes, use CSS variables');
    expect(prompt).toContain('brief was updated');
    expect(prompt).toContain('picked up after a crash');
    expect(prompt).not.toContain('SHARED.md + PROJECT.md digest');
    expect(prompt).toContain('## What to do now');
  });

  it('records worker bootstrap without pasting it into the first-turn prompt (VS-161)', async () => {
    const recorded: unknown[][] = [];
    h.services.knowledgeUsage = {
      recordBootstrap: (...args: unknown[]) => { recorded.push(args); },
    } as never;
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'system', reason: 'assigned', payload: {}, status: 'claimed' } as never;
    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], { isFirstTurn: true, runId: 'run-1' });
    expect(prompt).not.toContain('SHARED.md + PROJECT.md digest');
    expect(recorded).toEqual([['run-1', worker.id, ticketId, []]]);
  });

  it('still pastes the bootstrap digest into the conductor first-turn prompt (VS-161)', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [{ id: 'w2', source: 'system', reason: 'digest', payload: {} } as never], { isFirstTurn: true });
    expect(prompt).toContain('SHARED.md + PROJECT.md digest');
  });

  it('tells the admitted worker it holds the project merge slot and must re-sync', async () => {
    h.db.update('tickets', ticketId, { status: 'merging', mergeQueuedAt: nowIso(), mergeStartedAt: nowIso() });
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'merge_approved', reason: 'front of the queue', payload: {}, status: 'claimed' } as never;

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], {});
    expect(prompt).toContain('You hold the merge slot for this project');
    expect(prompt).toContain('sync `work/` with `main`');
    expect(prompt).toContain('ac_ticket_merge_done');
  });

  it("re-syncs with the project's declared landing branch, not the default branch (VS-119)", async () => {
    h.db.update('projects', h.projectId, { landingBranch: 'edge' });
    h.db.update('tickets', ticketId, { status: 'merging', mergeQueuedAt: nowIso(), mergeStartedAt: nowIso() });
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'merge_approved', reason: 'front of the queue', payload: {}, status: 'claimed' } as never;

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], {});
    expect(prompt).toContain('sync `work/` with `edge`');
  });

  it("re-syncs with the ticket's own landing branch, overriding the project's (VS-119)", async () => {
    h.db.update('projects', h.projectId, { landingBranch: 'edge' });
    h.db.update('tickets', ticketId, { status: 'merging', mergeQueuedAt: nowIso(), mergeStartedAt: nowIso(), landingBranch: 'main' });
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'merge_approved', reason: 'front of the queue', payload: {}, status: 'claimed' } as never;

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], {});
    expect(prompt).toContain('sync `work/` with `main`');
  });

  it('tells a waiting worker its position and that there is nothing to merge yet', async () => {
    const ahead = newId();
    const now = nowIso();
    h.db.insert('tickets', {
      id: ahead, workspaceId: h.workspaceId, projectId: h.projectId, number: 41, identifier: 'TST-41', kind: 'change',
      title: 'Ahead in the queue', description: '', status: 'merging', priority: 'high', createdByKind: 'agent',
      mergeQueuedAt: '2026-09-05T10:00:00.000Z', mergeStartedAt: now, createdAt: now, updatedAt: now,
    });
    h.db.update('tickets', ticketId, { status: 'merging', mergeQueuedAt: '2026-09-05T11:00:00.000Z', mergeStartedAt: null });
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'system', reason: 'liveness', payload: {}, status: 'claimed' } as never;

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], {});
    expect(prompt).toContain("Waiting in this project's merge queue at position 1");
    expect(prompt).not.toContain('You hold the merge slot');
  });

  it('lists open work and pending decisions for the conductor', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    h.db.insert('decisions', {
      id: 'd2', workspaceId: h.workspaceId, ticketId, kind: 'merge_approval', owner: 'human', title: 'Merge TST-42?',
      context: '', optionsJson: [], allowFreeText: 1, status: 'open', createdAt: nowIso(),
    });
    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [{ id: 'w2', source: 'system', reason: 'digest', payload: {} } as never], {});
    expect(prompt).toContain('## Open work');
    expect(prompt).toContain('TST-42 [approved] Add dark mode');
    expect(prompt).toContain('## Open decisions');
    expect(prompt).toContain('Merge TST-42?');
  });

  // A worker parked after a failure is waiting on the human, not stalled: the conductor must not
  // answer a usage limit by relaunching into it (VS-56).
  it('names why a paused worker stopped, and who owns the resume', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    h.db.update('agents', worker.id, {
      status: 'paused', pauseReason: 'rate_limit: waiting for a human',
      pauseDetailJson: { family: 'provider_quota', code: 'rate_limit', message: 'limit resets in 2 hours', resetAt: null, runId: 'r1' },
    });

    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [{ id: 'w3', source: 'system', reason: 'digest', payload: {} } as never], {});
    expect(prompt).toContain('paused: provider_quota — limit resets in 2 hours; the human owns the resume');

    // Without a structured detail there is nothing to say beyond the status.
    h.db.update('agents', worker.id, { pauseDetailJson: null });
    const plain = await buildTurnPrompt(h.ctx, h.deps, conductor, [{ id: 'w4', source: 'system', reason: 'digest', payload: {} } as never], {});
    expect(plain).toContain('(paused)');
    expect(plain).not.toContain('the human owns the resume');
  });

  it.runIf(existsSync(SHIPPED_TEMPLATES))('renders the shipped worker charter exactly once (VS-161)', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    const src = readFileSync(join(SHIPPED_TEMPLATES, 'worker.AGENTS.md.tmpl'), 'utf8');
    for (const comment of src.matchAll(/<!--[\s\S]*?-->/g)) {
      expect(comment[0]).not.toContain('{{');
    }
    const out = renderWorkerInstructions(h.ctx, h.deps, worker);
    expect(out.split('## Charter').length - 1).toBe(1);
    expect(out).not.toContain('definitionOfDone');
  });

  it.runIf(existsSync(SHIPPED_TEMPLATES))('renders the shipped templates without leaving placeholders', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    const worker0 = renderWorkerInstructions(h.ctx, h.deps, worker);
    expect(worker0).toContain('TST-42');
    expect(worker0).not.toMatch(/\{\{[#/]?[a-z]/i);
    const conductor = renderConductorInstructions(h.ctx, h.deps);
    expect(conductor).not.toMatch(/\{\{[#/]?[a-z]/i);
    const charter = renderCharter(h.ctx, spec);
    expect(charter).not.toMatch(/\{\{[#/]?[a-z]/i);
  });

  it.runIf(existsSync(SHIPPED_TEMPLATES))('tells agents not to pin Node via mise in a way that hides openspec (VS-170)', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    for (const name of ['conductor.AGENTS.md.tmpl', 'worker.AGENTS.md.tmpl'] as const) {
      const src = readFileSync(join(SHIPPED_TEMPLATES, name), 'utf8');
      expect(src).toContain('mise.toml');
      expect(src).toContain('openspec');
      expect(src).toMatch(/reinstall/i);
    }
    const worker0 = renderWorkerInstructions(h.ctx, h.deps, worker);
    const conductor = renderConductorInstructions(h.ctx, h.deps);
    for (const out of [worker0, conductor]) {
      expect(out).toContain('mise.toml');
      expect(out).toContain('openspec');
      expect(out).toMatch(/reinstall/i);
    }
  });

  it.runIf(existsSync(SHIPPED_TEMPLATES))('tells the conductor to ask with options when the answer is a closed set', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    const conductor = renderConductorInstructions(h.ctx, h.deps);
    expect(conductor).toContain('Ask with options when the answer is a closed set');
    expect(conductor).toContain('`ac_ask`');
    // The rule adds a form, it does not replace the ordinary reply path.
    expect(conductor).toContain('Reply with `ac_human_send`');
    expect(conductor).toContain('[short label](https://url)');
    expect(conductor).toContain('One logical reply is one `ac_human_send`');
  });

  it.runIf(existsSync(SHIPPED_TEMPLATES))('tells conductor and worker to use GH_TOKEN when gh auth status looks logged-out (VS-169)', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    const recipe = 'GH_TOKEN="$(gh auth token)"';
    const conductor = renderConductorInstructions(h.ctx, h.deps);
    expect(conductor).toContain(recipe);
    expect(conductor).toContain('gh auth login');
    expect(conductor).toContain('not a reason to ask Victor to authorize GitHub');
    expect(conductor).toContain('A logged-out `gh auth status` is not a needed credential');
    const worker0 = renderWorkerInstructions(h.ctx, h.deps, worker);
    expect(worker0).toContain(recipe);
    expect(worker0).toContain('gh auth login');
    expect(worker0).toContain('Do not ask the human or the conductor to authorize GitHub');
  });
});
