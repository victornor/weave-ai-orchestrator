/** The project overview's folding rules (VS-95), `lib/projectOverview.ts`. */
import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '@weave-ai/shared';
import {
  currentFocus,
  decisionsForProject,
  deliveryModeOf,
  knowledgeSections,
  lastLinesByAgent,
  recentLandings,
  resolveProject,
} from '../lib/projectOverview';
import { decision, project, run, ticket } from './factories';

const api = project({ id: 'p1', slug: 'api' });
const web = project({ id: 'p2', slug: 'web' });

describe('resolveProject', () => {
  it('finds a project by its slug', () => {
    expect(resolveProject([api, web], 'web')?.id).toBe('p2');
  });

  it('finds the same project by its id, the way GET /projects/:id does', () => {
    expect(resolveProject([api, web], 'p2')?.slug).toBe('web');
  });

  it('prefers an id over a slug when one project is named after another', () => {
    const odd = project({ id: 'web', slug: 'legacy' });
    expect(resolveProject([odd, web], 'web')?.slug).toBe('legacy');
  });

  it('is null for a project the workspace does not have, and for no address at all', () => {
    expect(resolveProject([api], 'ops')).toBeNull();
    expect(resolveProject([api], undefined)).toBeNull();
  });
});

describe('decisionsForProject', () => {
  const tickets = [ticket({ id: 'tk_1', projectId: 'p1' }), ticket({ id: 'tk_2', projectId: 'p2' })];

  it('keeps the decisions whose ticket is in the project', () => {
    const mine = decision({ id: 'd1', ticketId: 'tk_1' });
    const theirs = decision({ id: 'd2', ticketId: 'tk_2' });
    expect(decisionsForProject([mine, theirs], tickets, 'p1').map((d) => d.id)).toEqual(['d1']);
  });

  it('drops a workspace-level decision, which belongs to no project', () => {
    expect(decisionsForProject([decision({ ticketId: null })], tickets, 'p1')).toEqual([]);
  });

  it('drops a decision whose ticket is not loaded rather than guessing at it', () => {
    expect(decisionsForProject([decision({ ticketId: 'tk_9' })], tickets, 'p1')).toEqual([]);
  });
});

describe('lastLinesByAgent', () => {
  it('takes each agent"s newest summary', () => {
    const lines = lastLinesByAgent([
      run({ id: 'r1', agentId: 'a1', summary: 'older', finishedAt: '2026-09-01T09:00:00.000Z' }),
      run({ id: 'r2', agentId: 'a1', summary: 'newer', finishedAt: '2026-09-01T11:00:00.000Z' }),
      run({ id: 'r3', agentId: 'a2', summary: 'other worker', finishedAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(lines.get('a1')).toBe('newer');
    expect(lines.get('a2')).toBe('other worker');
  });

  it('orders a still-running turn by when it started', () => {
    const lines = lastLinesByAgent([
      run({ id: 'r1', agentId: 'a1', summary: 'finished', finishedAt: '2026-09-01T09:00:00.000Z' }),
      run({ id: 'r2', agentId: 'a1', summary: 'in flight', startedAt: '2026-09-01T12:00:00.000Z', finishedAt: null }),
    ]);
    expect(lines.get('a1')).toBe('in flight');
  });

  it('gives a worker with nothing to report no line at all', () => {
    expect(lastLinesByAgent([run({ agentId: 'a1', summary: null })]).has('a1')).toBe(false);
  });
});

const entry = (over: Partial<ChangelogEntry> & Pick<ChangelogEntry, 'kind' | 'at'>): ChangelogEntry => ({
  id: 'c1',
  actor: { kind: 'agent', id: 'a1', label: 'Engineer #7' },
  projectId: 'p1',
  ticketId: 'tk_1',
  ticketIdentifier: 'ACME-42',
  summary: 'landed',
  link: null,
  ...over,
});

describe('recentLandings', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  it('lists what landed in the window, newest first', () => {
    const landings = recentLandings(
      [
        entry({ kind: 'landed', at: '2026-09-02T10:00:00.000Z', ticketId: 'tk_1', ticketIdentifier: 'ACME-1' }),
        entry({ kind: 'landed', at: '2026-09-06T10:00:00.000Z', ticketId: 'tk_2', ticketIdentifier: 'ACME-2' }),
      ],
      now,
    );
    expect(landings.map((l) => l.identifier)).toEqual(['ACME-2', 'ACME-1']);
  });

  it('joins a landing to the pull request recorded for the same ticket', () => {
    const landings = recentLandings(
      [
        entry({ kind: 'landed', at: '2026-09-06T10:00:00.000Z', ticketId: 'tk_1' }),
        entry({ kind: 'pr_opened', at: '2026-09-05T10:00:00.000Z', ticketId: 'tk_1', link: { kind: 'url', target: 'https://example.com/pr/7' } }),
      ],
      now,
    );
    expect(landings[0]?.prUrl).toBe('https://example.com/pr/7');
  });

  it('lists a landing with no recorded pull request without one', () => {
    const landings = recentLandings([entry({ kind: 'landed', at: '2026-09-06T10:00:00.000Z' })], now);
    expect(landings[0]?.prUrl).toBeNull();
  });

  it('ignores a pull-request entry that only links to a ticket', () => {
    const landings = recentLandings(
      [
        entry({ kind: 'landed', at: '2026-09-06T10:00:00.000Z', ticketId: 'tk_1' }),
        entry({ kind: 'pr_opened', at: '2026-09-05T10:00:00.000Z', ticketId: 'tk_1', link: { kind: 'ticket', target: 'tk_1' } }),
      ],
      now,
    );
    expect(landings[0]?.prUrl).toBeNull();
  });

  it('leaves out anything older than the window, and anything that is not a landing', () => {
    const landings = recentLandings(
      [
        entry({ kind: 'landed', at: '2026-08-01T10:00:00.000Z', ticketIdentifier: 'OLD' }),
        entry({ kind: 'filed', at: '2026-09-06T10:00:00.000Z', ticketIdentifier: 'FILED' }),
      ],
      now,
    );
    expect(landings).toEqual([]);
  });
});

describe('deliveryModeOf', () => {
  const config = { defaults: { deliveryMode: 'pr' } };

  it('uses the project"s own mode when it sets one', () => {
    expect(deliveryModeOf(project({ policies: { deliveryMode: 'direct' } }), config)).toEqual({ mode: 'direct', inherited: false });
  });

  it('inherits the workspace default when the project sets none, and says so', () => {
    expect(deliveryModeOf(project({ policies: {} }), { defaults: { deliveryMode: 'direct' } })).toEqual({ mode: 'direct', inherited: true });
  });

  it('falls back to pr when neither states one', () => {
    expect(deliveryModeOf(project(), undefined)).toEqual({ mode: 'pr', inherited: true });
  });
});

const hub = [
  '# api — project knowledge',
  '',
  '<!-- The project knowledge base. Budget 10000 tokens. -->',
  '',
  '## Overview',
  '',
  '- 2026-09-04 · A thing that does things.',
  '',
  '## Current focus',
  '',
  '- 2026-09-06 · Throughput and trust in the web app.',
  '',
  '## Landmines',
  '',
  '- 2026-09-05 · Do not do that.',
  '',
].join('\n');

describe('knowledgeSections', () => {
  it('returns each section with its body, and drops the budget comment', () => {
    const sections = knowledgeSections(hub);
    expect(sections.map((s) => s.name)).toEqual(['Overview', 'Current focus', 'Landmines']);
    expect(sections[0]?.body).toBe('- 2026-09-04 · A thing that does things.');
  });

  it('is empty for a file that was never written', () => {
    expect(knowledgeSections(null)).toEqual([]);
    expect(knowledgeSections('')).toEqual([]);
  });

  it('keeps a section that has been left empty, with an empty body', () => {
    expect(knowledgeSections('## Learnings\n\n')).toEqual([{ name: 'Learnings', body: '' }]);
  });
});

describe('currentFocus', () => {
  it('reads the section the project wrote', () => {
    expect(currentFocus(hub)).toBe('- 2026-09-06 · Throughput and trust in the web app.');
  });

  it('is null when the file has no Current focus, so nothing stands in for it', () => {
    expect(currentFocus('## Overview\n\nsomething')).toBeNull();
  });

  it('is null when the section is there but empty', () => {
    expect(currentFocus('## Current focus\n\n<!-- a hint -->\n')).toBeNull();
  });
});
