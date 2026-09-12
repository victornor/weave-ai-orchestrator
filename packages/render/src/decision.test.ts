import { describe, expect, it } from 'vitest';
import { NAMED_CARD_OPTION_KEYS } from '@weave-ai/shared';
import type { Decision, DecisionKind } from '@weave-ai/shared';
import { decisionToCard } from './decision.js';

function decision(over: Partial<Decision> & { kind: DecisionKind }): Decision {
  return {
    id: 'dec_1', workspaceId: 'ws', ticketId: 'tkt_1', owner: 'human', askedByAgentId: 'ag_1', askedInRunId: 'run_1',
    title: 'Approve the plan for the tokens refactor', context: 'Six requirements, two of them new.',
    options: [], inputs: [], recommendation: null, status: 'open', answerKey: null, answerText: null, answerInputs: null,
    answeredByKind: null, answeredById: null, answeredAt: null, expiresAt: null, target: null, correlationKey: null,
    createdAt: '2026-09-04T11:56:00.000Z',
    weaverReviewStatus: 'unseen', weaverReviewedAt: null, weaverReviewNote: null, weaverReviewedByAgentId: null,
    ...over,
  } as Decision;
}
const now = new Date('2026-09-04T12:00:00.000Z');

describe('decisionToCard', () => {
  // VS-201: core no longer pre-cuts a failure message at 400 chars, so the TUI card's own cap
  // (raised from 600 to 1200) is now the binding one — it must still end with a visible marker
  // rather than a bare cut, and stay under the cap.
  it('caps a long context at 1200 chars with a visible ellipsis', () => {
    const context = `Last error: Cannot use this model: grok-4-6. Available models: ${'auto, '.repeat(300)}gpt-5.9-sol-xhigh`;
    expect(context.length).toBeGreaterThan(1200);
    const card = decisionToCard(decision({ kind: 'retry_approval', context, target: null }), { ticketIdentifier: 'ACME-42', now });
    const line = card.body.find((l) => l.value.startsWith('Last error:'));
    expect(line).toBeDefined();
    expect(line!.value.length).toBe(1200);
    expect(line!.value.endsWith('…')).toBe(true);
  });

  it('renders a short context in full, with no ellipsis (as the card rationale, not a duplicate body line)', () => {
    const context = 'Last error: the CLI died.';
    const card = decisionToCard(decision({ kind: 'retry_approval', context, target: null }), { ticketIdentifier: 'ACME-42', now });
    expect(card.rationale).toBe(context);
    expect(card.body.some((l) => l.value.startsWith('Last error:'))).toBe(false);
  });


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
      target: { prUrl: 'https://github.com/acme/web/pull/12', ciPassed: 7, ciTotal: 7, additions: 18, deletions: 2, files: 3, branch: 'ac/acme-42' },
    }), { now });
    expect(card.variant).toBe('merge_approval');
    expect(card.options.map((o) => o.label)).toEqual(['Approve merge', 'Request changes']);
    expect(card.allowFreeText).toBe(false);
    expect(card.body).toEqual([
      { label: 'PR', value: 'https://github.com/acme/web/pull/12', format: 'link' },
      { label: 'CI', value: '7/7', format: 'mono' },
      { label: 'Diff', value: '+18 −2', format: 'diff' },
      { label: 'Files', value: '3 files', format: 'mono' },
      { label: 'Branch', value: 'ac/acme-42', format: 'mono' },
      { label: 'Review', value: "Weaver hasn't reviewed yet", format: 'text' },
    ]);
  });

  it('renders a hire approval with Hire / Reject plus runtime switch options', () => {
    const card = decisionToCard(decision({
      kind: 'hire_approval',
      title: 'Hire a Backend Engineer',
      options: [{ key: 'switch:codex', label: 'Switch runtime to codex', description: 'Use Codex instead of Claude Code' }],
      target: { roleName: 'Backend Engineer', projectName: 'api', charterSummary: 'Owns the HTTP API and its tests', runtime: 'claude', model: 'claude-fable-5-1', maxWorkers: 2 },
    }), { now });
    expect(card.options.map((o) => o.key)).toEqual(['approve', 'reject', 'switch:codex']);
    expect(card.options[0]!.tone).toBe('primary');
    expect(card.options[2]!.tone).toBe('default');
    expect(card.body[0]).toEqual({ label: null, value: 'Backend Engineer · api', format: 'text' });
    expect(card.body).toContainEqual({ label: 'Runtime', value: 'claude · claude-fable-5-1', format: 'mono' });
    expect(card.body.some((row) => row.label === 'Max workers')).toBe(false);
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

  it('renders a concern like a question: free text, no forced options', () => {
    const card = decisionToCard(decision({
      kind: 'concern', title: "The ticket's stated fix looks insufficient",
      context: 'Tried X and Y; the bug still reproduces. Need a second look before I keep going.',
    }), { now });
    expect(card.variant).toBe('concern');
    expect(card.options).toEqual([]);
    expect(card.allowFreeText).toBe(true);
    expect(card.freeTextLabel).toBe('Something else…');
  });

  it('still renders any options a concern is given', () => {
    const card = decisionToCard(decision({
      kind: 'concern', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
    }), { now });
    expect(card.options.map((o) => o.key)).toEqual(['a', 'b']);
  });

  it('renders a discard approval as destructive with typed confirmation', () => {
    const card = decisionToCard(decision({
      kind: 'discard_approval', title: 'Discard the ACME-42 worktree',
      target: { worktreePath: '/ws/workers/w1/work', dirtyFiles: 3, branch: 'ac/acme-42' },
    }), { ticketIdentifier: 'ACME-42', now });
    expect(card.destructive).toBe(true);
    expect(card.confirm).toEqual({ expect: 'ACME-42', prompt: 'Type ACME-42 to confirm' });
    expect(card.options.map((o) => o.key)).toEqual(['approve', 'reject']);
    expect(card.options[0]!.tone).toBe('danger');
    expect(card.allowFreeText).toBe(false);
    expect(card.body.at(-1)!.value).toContain('destroys the worktree');
  });

  // VS-114: the same class of bug VS-111 fixed in packages/ui — a card option key that the
  // decision it answers does not actually accept. Each named variant here is given exactly the
  // options the daemon creates it with (packages/core/src/tickets/service.ts,
  // packages/core/src/roles/index.ts), so this fails the same way a hand-written literal that
  // drifts from NAMED_CARD_OPTION_KEYS would.
  it('never offers a named-variant option key the decision does not accept', () => {
    const real: Record<'plan_approval' | 'merge_approval' | 'hire_approval' | 'discard_approval' | 'action_approval', Array<{ key: string; label: string }>> = {
      plan_approval: [
        { key: 'approve', label: 'Approve' },
        { key: 'revise', label: 'Revise' },
        { key: 'reject', label: 'Reject' },
      ],
      action_approval: [
        { key: 'approve', label: 'Approve' },
        { key: 'revise', label: 'Revise' },
        { key: 'reject', label: 'Reject' },
      ],
      merge_approval: [
        { key: 'approve', label: 'Approve merge' },
        { key: 'changes', label: 'Request changes' },
      ],
      hire_approval: [
        { key: 'approve', label: 'Approve and activate' },
        { key: 'reject', label: 'Reject' },
      ],
      discard_approval: [
        { key: 'approve', label: 'Retire the role and cancel its workers' },
        { key: 'reject', label: 'Keep the role' },
      ],
    };
    for (const kind of Object.keys(real) as Array<keyof typeof real>) {
      const card = decisionToCard(decision({ kind, options: real[kind] }), { now });
      expect(card.options.map((o) => o.key)).toEqual(Object.values(NAMED_CARD_OPTION_KEYS[kind]));
    }
  });

  it('falls back to a generic approval for unknown kinds and conductor-owned headers', () => {
    const card = decisionToCard(decision({ kind: 'approval' as DecisionKind, owner: 'weaver' }), { now });
    expect(card.variant).toBe('approval');
    expect(card.header).toBe('Weaver decides');
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
    // Was null before VS-92. A card is now always labelled with its project, and a decision that
    // belongs to none is the workspace's: an absent label and an unresolved one must not look alike.
    expect(card.subtitle).toBe('Workspace');
    expect(card.uiStatus).toBe('needs-you');
  });
  // VS-92: the project label, and a card whose values this surface cannot collect.
  describe('the project and cards that ask for values', () => {
    it('says Workspace when no project is known, rather than leaving the label out', () => {
      const card = decisionToCard(decision({ kind: 'question', ticketId: null }), { now });
      expect(card.subtitle).toBe('Workspace');
    });

    it('names the project when one is given, next to the ticket', () => {
      expect(decisionToCard(decision({ kind: 'question' }), { ticketIdentifier: 'ACME-42', projectName: 'web', now }).subtitle).toBe('ACME-42 · web');
      // Still labelled when the ticket is all that is known.
      expect(decisionToCard(decision({ kind: 'question' }), { ticketIdentifier: 'ACME-42', now }).subtitle).toBe('ACME-42 · Workspace');
    });

    it('sends a card that asks for values to the web app instead of offering buttons', () => {
      const card = decisionToCard(decision({
        kind: 'question',
        inputs: [{ key: 'token', label: 'Read-only token', type: 'secret', secretName: 'CF_READONLY_TOKEN' }],
        options: [{ key: 'skip', label: 'Skip' }],
      }), { projectName: 'web', now });
      expect(card.answerElsewhere).toBe(true);
      expect(card.options).toEqual([]);
      expect(card.allowFreeText).toBe(false);
      expect(card.body.at(-1)).toMatchObject({ value: 'Answer this in the web app: it asks for 1 value.' });
      // The question itself is still readable here — only answering moves.
      expect(card.title).toBe('Approve the plan for the tokens refactor');
    });

    it('leaves a card without inputs exactly as it is', () => {
      const card = decisionToCard(decision({ kind: 'question', options: [{ key: 'skip', label: 'Skip' }] }), { projectName: 'web', now });
      expect(card.answerElsewhere).toBe(false);
      expect(card.options.map((o) => o.key)).toEqual(['skip']);
      expect(card.allowFreeText).toBe(true);
    });

    it('offers an answered card with inputs as a record rather than sending it elsewhere', () => {
      const card = decisionToCard(decision({
        kind: 'question', status: 'answered', answeredAt: '2026-09-04T11:58:00.000Z',
        inputs: [{ key: 'token', label: 'Token', type: 'secret', secretName: 'CF_READONLY_TOKEN' }],
        answerInputs: { token: 'CF_READONLY_TOKEN' },
      }), { projectName: 'web', now });
      expect(card.answerElsewhere).toBe(false);
    });
  });

  describe('conductor review body lines (VS-223, VS-234)', () => {
    it('shows the unseen line on plan, merge and action cards', () => {
      for (const kind of ['plan_approval', 'merge_approval', 'action_approval'] as const) {
        const card = decisionToCard(decision({ kind }), { now });
        expect(card.body).toContainEqual({ label: 'Review', value: "Weaver hasn't reviewed yet", format: 'text' });
      }
    });

    it('does not put a review line on a question card', () => {
      const card = decisionToCard(decision({ kind: 'question' }), { now });
      expect(card.body.some((l) => l.label === 'Review')).toBe(false);
      expect(card.body.some((l) => /Weaver/.test(l.value))).toBe(false);
    });

    it('uses after-the-fact wording only when reviewedAt is strictly later than answeredAt', () => {
      const prior = decisionToCard(decision({
        kind: 'plan_approval', status: 'answered', answeredAt: '2026-09-11T03:02:00.000Z',
        weaverReviewStatus: 'looked', weaverReviewedAt: '2026-09-11T03:01:00.000Z',
        weaverReviewNote: 'diff is exactly the plan',
      }), { now });
      expect(prior.body).toContainEqual({ label: 'Review', value: 'Weaver reviewed — no concerns', format: 'text' });

      const after = decisionToCard(decision({
        kind: 'merge_approval', status: 'answered', answeredAt: '2026-09-11T03:01:00.000Z',
        weaverReviewStatus: 'looked', weaverReviewedAt: '2026-09-11T03:02:00.000Z',
        weaverReviewNote: 'squash-merge verified after the rebase',
      }), { now });
      expect(after.body).toContainEqual({ label: 'Review', value: 'Weaver reviewed after you answered — no concerns', format: 'text' });
    });

    it('includes the concern note as a following body line', () => {
      const card = decisionToCard(decision({
        kind: 'plan_approval', weaverReviewStatus: 'concerns',
        weaverReviewedAt: '2026-09-11T03:01:00.000Z',
        weaverReviewNote: 'the migration contradicts itself',
      }), { now });
      expect(card.body).toContainEqual({ label: 'Review', value: 'Weaver reviewed — has concerns', format: 'text' });
      expect(card.body).toContainEqual({ label: null, value: 'the migration contradicts itself', format: 'text' });
    });

    it('marks the card held and adds the held sentence for an open concern (VS-266)', () => {
      const card = decisionToCard(decision({
        kind: 'plan_approval', status: 'open', weaverReviewStatus: 'concerns',
        weaverReviewedAt: '2026-09-11T03:01:00.000Z',
        weaverReviewNote: 'the migration contradicts itself',
      }), { now });
      expect(card.held).toBe(true);
      expect(card.body).toContainEqual({ label: null, value: 'Approval is held until this is revised, or you override it.', format: 'text' });
    });

    it('is not held once the concern-marked decision is answered', () => {
      const card = decisionToCard(decision({
        kind: 'merge_approval', status: 'answered', answeredAt: '2026-09-11T03:02:00.000Z',
        weaverReviewStatus: 'concerns', weaverReviewedAt: '2026-09-11T03:01:00.000Z',
        weaverReviewNote: 'screenshot is cropped',
      }), { now });
      expect(card.held).toBe(false);
      expect(card.body.some((l) => l.value.includes('is held'))).toBe(false);
    });

    it('is never held for a kind that does not carry conductor review', () => {
      const card = decisionToCard(decision({ kind: 'question', status: 'open' }), { now });
      expect(card.held).toBe(false);
    });

    it('shows a clean mark with its note, and a legacy mark as the line alone (VS-234)', () => {
      const noted = decisionToCard(decision({
        kind: 'merge_approval', weaverReviewStatus: 'looked',
        weaverReviewedAt: '2026-09-11T03:01:00.000Z',
        weaverReviewNote: 'squash diff matches the approved plan',
      }), { now });
      expect(noted.body).toContainEqual({ label: 'Review', value: 'Weaver reviewed — no concerns', format: 'text' });
      expect(noted.body).toContainEqual({ label: null, value: 'squash diff matches the approved plan', format: 'text' });

      const legacy = decisionToCard(decision({
        kind: 'merge_approval', weaverReviewStatus: 'looked',
        weaverReviewedAt: '2026-09-11T03:01:00.000Z',
        weaverReviewNote: null,
        target: { prUrl: 'https://github.com/acme/web/pull/12', ciPassed: 7, ciTotal: 7, additions: 18, deletions: 2, files: 3, branch: 'ac/acme-42' },
      }), { now });
      expect(legacy.body).toEqual([
        { label: 'PR', value: 'https://github.com/acme/web/pull/12', format: 'link' },
        { label: 'CI', value: '7/7', format: 'mono' },
        { label: 'Diff', value: '+18 −2', format: 'diff' },
        { label: 'Files', value: '3 files', format: 'mono' },
        { label: 'Branch', value: 'ac/acme-42', format: 'mono' },
        { label: 'Review', value: 'Weaver reviewed — no concerns', format: 'text' },
      ]);
    });
  });
});
