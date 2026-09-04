import { describe, expect, it } from 'vitest';
import type { Decision, DecisionKind } from '@openconductor/shared';
import { decisionToCard } from './decision.js';

function decision(over: Partial<Decision> & { kind: DecisionKind }): Decision {
  return {
    id: 'dec_1', workspaceId: 'ws', ticketId: 'tkt_1', owner: 'human', askedByAgentId: 'ag_1', askedInRunId: 'run_1',
    title: 'Approve the plan for the tokens refactor', context: 'Six requirements, two of them new.',
    options: [], recommendation: null, status: 'open', answerKey: null, answerText: null,
    answeredByKind: null, answeredById: null, answeredAt: null, expiresAt: null, target: null, correlationKey: null,
    createdAt: '2026-09-04T11:56:00.000Z', ...over,
  } as Decision;
}
const now = new Date('2026-09-04T12:00:00.000Z');

describe('decisionToCard', () => {
  it('renders a plan approval with Approve / Revise… / Reject and free text', () => {
    const card = decisionToCard(decision({ kind: 'plan_approval', target: { changeName: 'add-theme-tokens', taskCount: 6 } }), { ticketIdentifier: 'ACME-42', projectName: 'web', now });
    expect(card.variant).toBe('plan_approval');
    expect(card.header).toBe('Needs you');
    expect(card.subtitle).toBe('ACME-42 · web');
    expect(card.options.map((o) => o.key)).toEqual(['approve', 'revise', 'reject']);
    expect(card.options.map((o) => o.label)).toEqual(['Approve', 'Revise…', 'Reject']);
    expect(card.options[0]!.tone).toBe('primary');
    expect(card.allowFreeText).toBe(true);
    expect(card.freeTextLabel).toBe('Add a note…');
    expect(card.body).toContainEqual({ label: 'Change', value: 'add-theme-tokens', format: 'mono' });
    expect(card.age).toBe('4m');
  });

  it('renders a merge approval with PR, CI, diff and files', () => {
    const card = decisionToCard(decision({
      kind: 'merge_approval',
      title: 'Merge ACME-42',
      target: { prUrl: 'https://github.com/acme/web/pull/12', ciPassed: 7, ciTotal: 7, additions: 18, deletions: 2, files: 3, branch: 'oc/acme-42' },
    }), { now });
    expect(card.variant).toBe('merge_approval');
    expect(card.options.map((o) => o.label)).toEqual(['Approve merge', 'Hold']);
    expect(card.allowFreeText).toBe(false);
    expect(card.body).toEqual([
      { label: 'PR', value: 'https://github.com/acme/web/pull/12', format: 'link' },
      { label: 'CI', value: '7/7', format: 'mono' },
      { label: 'Diff', value: '+18 −2', format: 'diff' },
      { label: 'Files', value: '3 files', format: 'mono' },
      { label: 'Branch', value: 'oc/acme-42', format: 'mono' },
    ]);
  });

  it('renders a hire approval with Hire / Reject plus runtime switch options', () => {
    const card = decisionToCard(decision({
      kind: 'hire_approval',
      title: 'Hire a Backend Engineer',
      options: [{ key: 'switch:codex', label: 'Switch runtime to codex', description: 'Use Codex instead of Claude Code' }],
      target: { roleName: 'Backend Engineer', projectName: 'api', charterSummary: 'Owns the HTTP API and its tests', runtime: 'claude', model: 'claude-fable-5-1', maxWorkers: 2 },
    }), { now });
    expect(card.options.map((o) => o.key)).toEqual(['hire', 'reject', 'switch:codex']);
    expect(card.options[0]!.tone).toBe('primary');
    expect(card.options[2]!.tone).toBe('default');
    expect(card.body[0]).toEqual({ label: null, value: 'Backend Engineer · api', format: 'text' });
    expect(card.body).toContainEqual({ label: 'Runtime', value: 'claude · claude-fable-5-1', format: 'mono' });
  });

  it('renders a question with the recommended option first and free text', () => {
    const card = decisionToCard(decision({
      kind: 'question',
      title: 'Which store for sessions?',
      allowFreeText: true,
      options: [
        { key: 'redis', label: 'Redis', description: 'Another service to run' },
        { key: 'sqlite', label: 'SQLite', description: 'No new dependency', recommended: true },
        { key: 'memory', label: 'In memory' },
      ],
      recommendation: 'SQLite: no new dependency',
    }), { now });
    expect(card.variant).toBe('question');
    expect(card.options.map((o) => o.key)).toEqual(['sqlite', 'redis', 'memory']);
    expect(card.options[0]!.recommended).toBe(true);
    expect(card.options[0]!.tone).toBe('primary');
    expect(card.options[0]!.consequence).toBe('No new dependency');
    expect(card.allowFreeText).toBe(true);
    expect(card.freeTextLabel).toBe('Something else…');
    expect(card.rationale).toBe('Recommended: SQLite: no new dependency');
  });

  it('keeps question option order stable when nothing is recommended', () => {
    const card = decisionToCard(decision({
      kind: 'question', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
    }), { now });
    expect(card.options.map((o) => o.key)).toEqual(['a', 'b', 'c']);
  });

  it('renders a discard approval as destructive with typed confirmation', () => {
    const card = decisionToCard(decision({
      kind: 'discard_approval', title: 'Discard the ACME-42 worktree',
      target: { worktreePath: '/ws/workers/w1/work', dirtyFiles: 3, branch: 'oc/acme-42' },
    }), { ticketIdentifier: 'ACME-42', now });
    expect(card.destructive).toBe(true);
    expect(card.confirm).toEqual({ expect: 'ACME-42', prompt: 'Type ACME-42 to confirm' });
    expect(card.options[0]!.tone).toBe('danger');
    expect(card.allowFreeText).toBe(false);
    expect(card.body.at(-1)!.value).toContain('destroys the worktree');
  });

  it('falls back to a generic approval for unknown kinds and conductor-owned headers', () => {
    const card = decisionToCard(decision({ kind: 'approval' as DecisionKind, owner: 'conductor' }), { now });
    expect(card.variant).toBe('approval');
    expect(card.header).toBe('Conductor decides');
    expect(card.options.map((o) => o.key)).toEqual(['approve', 'reject']);
  });

  it('carries the answer and the answered ui status once answered', () => {
    const card = decisionToCard(decision({ kind: 'plan_approval', status: 'answered', answerKey: 'approve', answerText: 'go', answeredAt: '2026-09-04T11:58:00.000Z' }), { now });
    expect(card.uiStatus).toBe('done');
    expect(card.answer).toEqual({ key: 'approve', text: 'go', at: '2026-09-04T11:58:00.000Z' });
  });

  it('redacts secrets in titles, context and options', () => {
    const card = decisionToCard(decision({
      kind: 'question', title: 'Use token rt_abcdefghijklmnop?', context: 'set with sk-ant-api03-AAAAbbbbCCCCddddEEEE',
      options: [{ key: 'yes', label: 'Yes, rt_abcdefghijklmnop' }],
    }), { now });
    expect(card.title).toBe('Use token rt_[redacted]?');
    expect(card.rationale).toBe('set with sk-[redacted]');
    expect(card.options[0]!.label).toBe('Yes, rt_[redacted]');
  });

  it('never crashes on a half-empty decision', () => {
    const card = decisionToCard({ id: 'd', kind: 'question', status: 'open' } as Decision, {});
    expect(card.title).toBe('Decision');
    expect(card.options).toEqual([]);
    expect(card.subtitle).toBeNull();
    expect(card.uiStatus).toBe('needs-you');
  });
});
