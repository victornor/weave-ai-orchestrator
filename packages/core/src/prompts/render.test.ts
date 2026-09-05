import { existsSync } from 'node:fs';
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
    expect(prompt).toContain('SHARED.md + PROJECT.md digest');
    expect(prompt).toContain('## What to do now');
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

  it.runIf(existsSync(SHIPPED_TEMPLATES))('tells the conductor to ask with options when the answer is a closed set', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    const conductor = renderConductorInstructions(h.ctx, h.deps);
    expect(conductor).toContain('Ask with options when the answer is a closed set');
    expect(conductor).toContain('`ac_ask`');
    // The rule adds a form, it does not replace the ordinary reply path.
    expect(conductor).toContain('Reply with `ac_human_send`');
  });
});
