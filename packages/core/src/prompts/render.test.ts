import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import type { Agent, RoleSpec } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { buildTurnPrompt, humanName, renderBrief, renderCharter, renderConductorInstructions, renderWorkerInstructions } from './index.js';

const SHIPPED_TEMPLATES = fileURLToPath(new URL('../../../../templates', import.meta.url));

/** The body between a `## heading` and the next `##` heading, for asserting a rendered section is not blank. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) return '';
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

const spec: RoleSpec = {
  id: 'api-backend', name: 'Backend Engineer', project: 'api', charterSummary: 'Owns the api service.',
  scope: 'Backend work in the api repo.', responsibilities: ['Implement handlers'], capabilities: ['node'],
  exclusions: ['frontend'], rules: ['Run the tests'], runtime: 'claude', model: null, sessionPolicy: 'per_ticket',
  maxWorkers: 2, permission: { mode: 'auto', allowed: [], denied: [] }, secrets: [], createdBy: 'weaver',
} as RoleSpec;

describe('prompt rendering', () => {
  let h: TestHarness;
  let worker: Agent;
  let ticketId: string;

  beforeEach(() => {
    h = makeHarness({ config: { weaver: { runtime: 'claude', model: null, channels: ['web'], humanName: 'Victor' } as never } });
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
    h.ctx.config = { ...h.ctx.config, weaver: { ...h.ctx.config.weaver, humanName: undefined } };
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

  describe('mentions work/AGENTS.md and work/openspec/config.yaml only when the worktree has them (VS-211)', () => {
    const dirs: string[] = [];
    afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

    const withWorktree = (contents: { agentsMd?: boolean; openspecConfig?: boolean } = {}): Agent => {
      const dir = mkdtempSync(join(tmpdir(), 'ac-worktree-'));
      dirs.push(dir);
      if (contents.agentsMd) writeFileSync(join(dir, 'AGENTS.md'), '# project agents\n', 'utf8');
      if (contents.openspecConfig) {
        mkdirSync(join(dir, 'openspec'), { recursive: true });
        writeFileSync(join(dir, 'openspec', 'config.yaml'), 'schema: spec-driven\n', 'utf8');
      }
      // A fresh ticket per call: `agents.ticket_id` is unique, and the outer `beforeEach` already
      // bound one worker to `ticketId`.
      const otherTicketId = newId();
      const now = nowIso();
      h.db.insert('tickets', {
        id: otherTicketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 900 + dirs.length, identifier: `TST-${900 + dirs.length}`,
        kind: 'task', title: 'Worktree fixture', description: '', status: 'in_progress', priority: 'medium',
        assigneeRoleId: h.roleId, createdByKind: 'agent', createdAt: now, updatedAt: now,
      });
      const id = h.addWorker(otherTicketId, { branch: 'ac/worktree-fixture', worktreePath: dir });
      return h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [id])!;
    };

    it('with the built-in fallback templates: reads it when present', () => {
      const w = withWorktree({ agentsMd: true });
      expect(renderBrief(h.ctx, h.deps, w)).toContain('Read `work/AGENTS.md` once.');
      expect(renderBrief(h.ctx, h.deps, w)).not.toContain('has no `work/AGENTS.md`');
    });

    it('with the built-in fallback templates: says plainly there is none, and does not tell the worker to read it', () => {
      const w = withWorktree({});
      const brief = renderBrief(h.ctx, h.deps, w);
      expect(brief).not.toContain('Read `work/AGENTS.md` once.');
      expect(brief).toContain('This project has no `work/AGENTS.md` of its own.');
      expect(brief).not.toMatch(/\{\{|\}\}/);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('with the shipped templates: names both files when present, in the brief and in the worker AGENTS.md', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const w = withWorktree({ agentsMd: true, openspecConfig: true });
      const brief = renderBrief(h.ctx, h.deps, w);
      expect(brief).toContain('Then read `work/AGENTS.md`');
      expect(brief).toContain('- `work/AGENTS.md` — the project\'s own contributor instructions.');
      expect(brief).toContain('- `work/openspec/config.yaml` — the project\'s OpenSpec context and rules.');
      const instructions = renderWorkerInstructions(h.ctx, h.deps, w);
      expect(instructions).toContain('read `work/AGENTS.md` once');
      expect(instructions).toContain('See `work/AGENTS.md`.');
      expect(instructions).toContain('OpenSpec context and rules are in `work/openspec/config.yaml`.');
      expect(brief).not.toMatch(/\{\{|\}\}/);
      expect(instructions).not.toMatch(/\{\{[#/]?[a-z]/i);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('with the shipped templates: names neither file, and no failed-read instruction survives, when the worktree has none', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const w = withWorktree({});
      const brief = renderBrief(h.ctx, h.deps, w);
      expect(brief).not.toContain('read `work/AGENTS.md`');
      expect(brief).not.toContain('- `work/AGENTS.md` —');
      expect(brief).not.toContain('- `work/openspec/config.yaml` —');
      expect(brief).toContain('This project has no `work/AGENTS.md` of its own');
      const instructions = renderWorkerInstructions(h.ctx, h.deps, w);
      expect(instructions).not.toContain('read `work/AGENTS.md`');
      expect(instructions).not.toContain('See `work/AGENTS.md`.');
      expect(instructions).not.toContain('OpenSpec context and rules are in `work/openspec/config.yaml`.');
      expect(instructions).toContain('This project has no `work/AGENTS.md` of its own');
      expect(brief).not.toMatch(/\{\{|\}\}/);
      expect(instructions).not.toMatch(/\{\{[#/]?[a-z]/i);
    });
  });

  it('renders the weaver instructions with the live portfolio', () => {
    const out = renderConductorInstructions(h.ctx, h.deps);
    expect(out).toContain('Test Workspace');
    expect(out).toContain('`api`');
    expect(out).toContain('Backend Engineer');
    expect(out).not.toMatch(/\{\{|\}\}/);
  });

  it('names the weaver project list by the display label, falling back to the slug (VS-330)', () => {
    h.db.update('projects', h.projectId, { name: 'Weave AI' });
    expect(renderConductorInstructions(h.ctx, h.deps)).toContain('- `api` — Weave AI');

    h.db.update('projects', h.projectId, { name: '' });
    const out = renderConductorInstructions(h.ctx, h.deps);
    expect(out).toContain('- `api` — api (default branch `main`)');
    expect(out).not.toContain('- `api` —  ');
  });

  describe('shipped conductor template fills its portfolio sections (VS-243)', () => {
    it.runIf(existsSync(SHIPPED_TEMPLATES))('lists the live projects and roles, not blank sections', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const out = renderConductorInstructions(h.ctx, h.deps);

      const projects = section(out, '## Projects in this workspace');
      const roles = section(out, '## Roles and live workers');
      expect(projects).toContain('`api`');
      expect(projects).toContain('API');
      expect(roles).toContain('Backend Engineer');
      expect(roles).toContain('2 workers live');
      expect(projects.trim()).not.toBe('');
      expect(roles.trim()).not.toBe('');
      expect(out).not.toMatch(/\{\{[#/]?[a-z]/i);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('renders the empty-state text for a workspace with none', () => {
      const bare = makeHarness({ bare: true });
      try {
        bare.ctx.templatesDir = SHIPPED_TEMPLATES;
        const out = renderConductorInstructions(bare.ctx, bare.deps);
        expect(section(out, '## Projects in this workspace')).toContain('(none yet)');
        expect(section(out, '## Roles and live workers')).toContain('(none hired yet)');
        expect(out).not.toMatch(/\{\{[#/]?[a-z]/i);
      } finally {
        bare.cleanup();
      }
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('the shipped worker template consumes its object data (no same-class mismatch)', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const out = renderWorkerInstructions(h.ctx, h.deps, worker);
      expect(out).toContain('Backend Engineer');
      expect(out).toContain('TST-42');
      expect(out).toContain('`api`');
      expect(out).not.toMatch(/\{\{[#/]?[a-z]/i);
    });
  });

  describe('shipped charter and brief templates read their renderer data (VS-247)', () => {
    /** A fresh task ticket and worker per call: `agents.ticket_id` is unique per live worker. */
    const freshWorker = (over: Record<string, unknown>): Agent => {
      const otherTicketId = newId();
      const now = nowIso();
      h.db.insert('tickets', {
        id: otherTicketId, workspaceId: h.workspaceId, projectId: h.projectId, number: 800, identifier: 'TST-800',
        kind: 'task', title: 'Curate project knowledge (api)', description: '', status: 'todo', priority: 'low',
        assigneeRoleId: h.roleId, createdByKind: 'agent', originKind: 'curation', createdAt: now, updatedAt: now,
      });
      const id = h.addWorker(otherTicketId, over);
      return h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [id])!;
    };

    it.runIf(existsSync(SHIPPED_TEMPLATES))('the shipped charter header names the project, branch, delivery mode and merge method', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const charter = renderCharter(h.ctx, spec);
      expect(charter).toContain('**Project:** `api`');
      expect(charter).toContain('default branch `main`');
      expect(charter).toContain('delivery `pr`');
      expect(charter).toContain('merge method `squash`');
      expect(charter).not.toMatch(/\{\{[#/]?[a-z]/i);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('the shipped charter header reads the project row and its policies, not constants', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      h.db.update('projects', h.projectId, { defaultBranch: 'trunk', policiesJson: { deliveryMode: 'local-branch', mergeMethod: 'merge' } });
      const charter = renderCharter(h.ctx, spec);
      expect(charter).toContain('default branch `trunk`');
      expect(charter).toContain('delivery `local-branch`');
      expect(charter).toContain('merge method `merge`');
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('the shipped brief gives a no-worktree worker the curation block, not the worktree one', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const clonePath = h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath;
      const brief = renderBrief(h.ctx, h.deps, freshWorker({ worktreePath: null, branch: null }));
      expect(brief).toContain('This is a curation ticket and has no worktree of its own');
      expect(brief).toContain('`work/` is the project\'s primary clone, read-only');
      // VS-256: the brief states the real, absolute clone path, not the unbacked literal `work/`.
      expect(brief).toContain(`Its absolute path is \`${clonePath}\`.`);
      expect(brief).toContain('never write to it, never commit, never push');
      expect(brief).toContain('Load `weave-ai-knowledge` and follow the curation procedure');
      expect(brief).not.toContain('Your worktree is');
      expect(brief).not.toContain('Before anything else, call `weave_worktree_status`');
      expect(brief).not.toMatch(/\{\{[#/]?[a-z]/i);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('states the moment the checkout was verified fresh, when the engine recorded one (VS-256)', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      h.db.update('projects', h.projectId, { lastFetchedAt: '2026-09-11T21:30:00.000Z' });
      const brief = renderBrief(h.ctx, h.deps, freshWorker({ worktreePath: null, branch: null }));
      expect(brief).toContain('verified as of `2026-09-11T21:30:00.000Z`');
      expect(brief).not.toMatch(/\{\{[#/]?[a-z]/i);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('says nothing about verification when the project has never been fetched', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const brief = renderBrief(h.ctx, h.deps, freshWorker({ worktreePath: null, branch: null }));
      expect(brief).not.toContain('verified as of');
      expect(brief).not.toMatch(/\{\{[#/]?[a-z]/i);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('the shipped brief still gives an ordinary worker its worktree-setup block', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const brief = renderBrief(h.ctx, h.deps, freshWorker({ worktreePath: '/tmp/ac-tst-800/work', branch: 'ac/tst-800-curate' }));
      expect(brief).toContain('Your worktree is');
      expect(brief).toContain('Before anything else, call `weave_worktree_status`');
      expect(brief).not.toContain('This is a curation ticket');
      expect(brief).not.toMatch(/\{\{[#/]?[a-z]/i);
    });
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

    it('states the policy in the weaver instructions, both ways', () => {
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

  it('tells a resumed turn it was interrupted to deliver a live message, and names the message and the stale-lock check (VS-254)', async () => {
    const wake = {
      id: 'w-li', workspaceId: h.workspaceId, agentId: worker.id, source: 'live_interrupt',
      reason: 'stop, wrong direction', payload: { ticketId, message: 'stop, wrong direction', interruptedRunId: 'run-9' }, status: 'claimed',
    } as never;

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], {});
    expect(prompt).toContain('live_interrupt: stop, wrong direction');
    expect(prompt).toContain('Your previous turn was interrupted to deliver the live message above');
    expect(prompt).toContain("index.lock");
  });

  it('adds no interrupted-by-message note when no `live_interrupt` wake is present', async () => {
    const wake = { id: 'w-plain', workspaceId: h.workspaceId, agentId: worker.id, source: 'ticket_comment', reason: 'a routine comment', payload: {}, status: 'claimed' } as never;

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], {});
    expect(prompt).not.toContain('interrupted to deliver the live message');
  });

  const wakeFor = (id: string) => ({ id, workspaceId: h.workspaceId, agentId: worker.id, source: 'system', reason: 'assigned', payload: {}, status: 'claimed' } as never);
  const promptAt = async (turnCount: number) => {
    h.db.update('agents', worker.id, { turnCount });
    const agent = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [worker.id])!;
    return buildTurnPrompt(h.ctx, h.deps, agent, [wakeFor(`w-t${turnCount}`)], {});
  };

  it('keeps the conversational posture on every interactive turn, not just the first (VS-213)', async () => {
    h.db.update('tickets', ticketId, { interactiveSession: true });

    const first = await promptAt(0);
    expect(first).toContain('post exactly one `weave_ticket_comment`');
    expect(first).toContain("wait for the human's first message");
    expect(first).not.toContain('do the phase your ticket status asks for');

    for (const n of [1, 2]) {
      const later = await promptAt(n);
      expect(later).toContain('conversation with the human');
      expect(later).toContain('complete success');
      expect(later).not.toContain('do the phase your ticket status asks for');
      expect(later).not.toContain('post exactly one `weave_ticket_comment`');
    }
  });

  it('keeps the delivery instruction on ordinary workers across turns (VS-213)', async () => {
    for (const n of [0, 1, 2]) {
      const prompt = await promptAt(n);
      expect(prompt).toContain('do the phase your ticket status asks for');
      expect(prompt).not.toContain('This is an interactive session');
    }
  });

  describe('interactive session contract in the brief and worker AGENTS.md (VS-213)', () => {
    it('with the built-in fallback templates: conversation-only done when the ticket is interactive', () => {
      h.db.update('tickets', ticketId, { interactiveSession: true });
      const brief = renderBrief(h.ctx, h.deps, worker);
      expect(brief).toContain('a good answer with nothing delivered is complete success');
      expect(brief).toContain('A conversation that ends with a good answer is done');
      expect(brief).not.toContain('planning artifacts complete');
      expect(brief).not.toMatch(/\{\{|\}\}/);
    });

    it('with the built-in fallback templates: ordinary tickets keep the delivery definition of done', () => {
      const brief = renderBrief(h.ctx, h.deps, worker);
      expect(brief).toContain('planning artifacts complete');
      expect(brief).not.toContain('a good answer with nothing delivered is complete success');
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('with the shipped templates: interactive tickets drop the phase table and the delivery definition of done', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      h.db.update('tickets', ticketId, { interactiveSession: true });
      const brief = renderBrief(h.ctx, h.deps, worker);
      expect(brief).toContain('a good answer with nothing delivered is complete success');
      expect(brief).toContain('A conversation that ends with a good answer is done');
      expect(brief).not.toContain('Plan approval and merge approval are the human\'s');
      expect(brief).not.toContain('planning artifacts complete and validated');
      const instructions = renderWorkerInstructions(h.ctx, h.deps, worker);
      expect(instructions).toContain('Conversation is the posture for every turn');
      expect(instructions).not.toContain('Do the phase your ticket status asks for');
      expect(brief).not.toMatch(/\{\{|\}\}/);
      expect(instructions).not.toMatch(/\{\{[#/]?[a-z]/i);
    });

    it.runIf(existsSync(SHIPPED_TEMPLATES))('with the shipped templates: ordinary tickets keep the phase table and definition of done', () => {
      h.ctx.templatesDir = SHIPPED_TEMPLATES;
      const brief = renderBrief(h.ctx, h.deps, worker);
      expect(brief).toContain('Plan approval and merge approval are the human\'s');
      expect(brief).toContain('planning artifacts complete and validated');
      expect(brief).not.toContain('a good answer with nothing delivered is complete success');
      const instructions = renderWorkerInstructions(h.ctx, h.deps, worker);
      expect(instructions).toContain('Do the phase your ticket status asks for');
      expect(instructions).not.toContain('Conversation is the posture for every turn');
    });
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

  it('still pastes the bootstrap digest into the weaver first-turn prompt (VS-161)', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [{ id: 'w2', source: 'system', reason: 'digest', payload: {} } as never], { isFirstTurn: true });
    expect(prompt).toContain('SHARED.md + PROJECT.md digest');
  });

  it('names the decision in the weaver\'s wake line (VS-361)', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    const wake = { id: 'w-d', workspaceId: h.workspaceId, agentId: conductor.id, source: 'system', reason: 'decision plan_approval awaits your review', payload: { decisionId: 'd-42', ticketId }, status: 'claimed' } as never;
    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [wake], {});
    expect(prompt).toContain('decision plan_approval awaits your review (decision d-42)');
  });

  it('leaves a wake without a decision id unchanged in the weaver prompt (VS-361)', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    const wake = { id: 'w-n', workspaceId: h.workspaceId, agentId: conductor.id, source: 'system', reason: 'digest', payload: {}, status: 'claimed' } as never;
    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [wake], {});
    expect(prompt).toContain('- system: digest');
    expect(prompt).not.toContain('(decision ');
  });

  it('pastes the bootstrap digest for a stale worker session whose home was not re-rendered this turn (VS-244)', async () => {
    const recorded: unknown[][] = [];
    h.services.knowledgeUsage = {
      recordBootstrap: (...args: unknown[]) => { recorded.push(args); },
    } as never;
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'system', reason: 'resume', payload: {}, status: 'claimed' } as never;
    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], { sessionStale: true, homeRerendered: false, runId: 'run-1' });
    expect(prompt).toContain('SHARED.md + PROJECT.md digest');
    expect(recorded).toEqual([['run-1', worker.id, ticketId, []]]);
  });

  it('still skips the bootstrap paste for a stale worker session whose home was freshly re-rendered this turn (VS-244)', async () => {
    const recorded: unknown[][] = [];
    h.services.knowledgeUsage = {
      recordBootstrap: (...args: unknown[]) => { recorded.push(args); },
    } as never;
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'system', reason: 'resume', payload: {}, status: 'claimed' } as never;
    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], { sessionStale: true, homeRerendered: true, runId: 'run-1' });
    expect(prompt).not.toContain('SHARED.md + PROJECT.md digest');
    expect(recorded).toEqual([['run-1', worker.id, ticketId, []]]);
  });

  it('tells the admitted worker it holds the project merge slot and must re-sync', async () => {
    h.db.update('tickets', ticketId, { status: 'merging', mergeQueuedAt: nowIso(), mergeStartedAt: nowIso() });
    const wake = { id: 'w1', workspaceId: h.workspaceId, agentId: worker.id, source: 'merge_approved', reason: 'front of the queue', payload: {}, status: 'claimed' } as never;

    const prompt = await buildTurnPrompt(h.ctx, h.deps, worker, [wake], {});
    expect(prompt).toContain('You hold the merge slot for this project');
    expect(prompt).toContain('sync `work/` with `main`');
    expect(prompt).toContain('weave_ticket_merge_done');
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

  it('lists open work and pending decisions for the weaver', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    h.db.insert('decisions', {
      id: 'd2', workspaceId: h.workspaceId, ticketId, kind: 'merge_approval', owner: 'human', title: 'Merge TST-42?',
      context: '', optionsJson: [], allowFreeText: 1, status: 'open', createdAt: nowIso(),
    });
    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [{ id: 'w2', source: 'system', reason: 'digest', payload: {} } as never], {});
    expect(prompt).toContain('## Open work');
    expect(prompt).toContain('TST-42 [approved] Add dark mode');
    expect(prompt).toContain('## Open decisions');
    // VS-306: each line carries the ticket's identifier and status, and the decision's age last.
    expect(prompt).toMatch(/- d2 \[merge_approval, owner human, TST-42 approved, \d+[smhdw]\] Merge TST-42\?/);
  });

  it('shows the age of a ticketless open decision without a ticket segment (VS-306)', async () => {
    const conductor = h.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [h.conductorId])!;
    h.db.insert('decisions', {
      id: 'd3', workspaceId: h.workspaceId, ticketId: null, kind: 'question', owner: 'human', title: 'Workspace question?',
      context: '', optionsJson: [], allowFreeText: 1, status: 'open', createdAt: nowIso(),
    });
    const prompt = await buildTurnPrompt(h.ctx, h.deps, conductor, [{ id: 'w5', source: 'system', reason: 'digest', payload: {} } as never], {});
    expect(prompt).toMatch(/- d3 \[question, owner human, \d+[smhdw]\] Workspace question\?/);
  });

  // A worker parked after a failure is waiting on the human, not stalled: the weaver must not
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
    for (const name of ['weaver.AGENTS.md.tmpl', 'worker.AGENTS.md.tmpl'] as const) {
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

  it.runIf(existsSync(SHIPPED_TEMPLATES))('tells the weaver to mark plan/merge/action cards after reading them (VS-223)', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    const conductor = renderConductorInstructions(h.ctx, h.deps);
    expect(conductor).toContain('weave_decision_review');
    expect(conductor).toMatch(/Do not mark at the start of the turn/);
    const worker0 = renderWorkerInstructions(h.ctx, h.deps, worker);
    expect(worker0).not.toContain('weave_decision_review');
  });

  it.runIf(existsSync(SHIPPED_TEMPLATES))('tells the weaver to ask with options when the answer is a closed set', () => {
    h.ctx.templatesDir = SHIPPED_TEMPLATES;
    const conductor = renderConductorInstructions(h.ctx, h.deps);
    expect(conductor).toContain('Ask with options when the answer is a closed set');
    expect(conductor).toContain('`weave_ask`');
    // The rule adds a form, it does not replace the ordinary reply path.
    expect(conductor).toContain('Reply with `weave_human_send`');
    expect(conductor).toContain('[short label](https://url)');
    expect(conductor).toContain('One logical reply is one `weave_human_send`');
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
    expect(worker0).toContain('Do not ask the human or the weaver to authorize GitHub');
  });
});
