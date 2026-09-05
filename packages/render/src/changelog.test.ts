import { describe, expect, it } from 'vitest';
import { changelogEntry, changelogKindOf, dayKey, groupTimeline, monthKey, weekKey, type ActivityRow } from './changelog.js';

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'a1', action: 'ticket.create', actorKind: 'human', actorId: 'victor', entityType: 'ticket', entityId: 't1',
  ticketId: 't1', projectId: 'p1', details: {}, createdAt: '2026-09-05T10:00:00.000Z', ...over,
});

describe('changelogKindOf', () => {
  it('projects each of the seven kinds from its action', () => {
    expect(changelogKindOf('ticket.create')).toBe('filed');
    expect(changelogKindOf('ticket.transition', { to: 'approved' })).toBe('plan_approved');
    expect(changelogKindOf('ticket.work_product', { type: 'pull_request' })).toBe('pr_opened');
    expect(changelogKindOf('ticket.delivery_landed')).toBe('landed');
    expect(changelogKindOf('ticket.cancel')).toBe('cancelled');
    expect(changelogKindOf('role.hire')).toBe('hired');
    expect(changelogKindOf('daemon.upgraded')).toBe('upgraded');
  });

  // Both of these actions carry several meanings; only one meaning of each is a changelog entry.
  it('rejects the same action carrying a different meaning', () => {
    expect(changelogKindOf('ticket.transition', { to: 'in_progress' })).toBeNull();
    expect(changelogKindOf('ticket.transition', {})).toBeNull();
    expect(changelogKindOf('ticket.work_product', { type: 'branch' })).toBeNull();
    expect(changelogKindOf('ticket.work_product', { type: 'report' })).toBeNull();
  });

  it('ignores an operational action entirely', () => {
    for (const action of ['ticket.checkout', 'knowledge.write', 'wake.enqueue', 'worker.spawn', 'decision.answer']) {
      expect(changelogKindOf(action)).toBeNull();
    }
  });
});

describe('changelogEntry', () => {
  it('renders a filed ticket', () => {
    const e = changelogEntry(row({ details: { kind: 'change', identifier: 'VS-55' } }), { ticketIdentifier: 'VS-55', ticketTitle: 'Add a changelog' })!;
    expect(e).toMatchObject({
      id: 'a1', at: '2026-09-05T10:00:00.000Z', kind: 'filed', projectId: 'p1', ticketId: 't1', ticketIdentifier: 'VS-55',
      summary: 'Filed change: Add a changelog', link: { kind: 'ticket', target: 't1' },
    });
    expect(e.actor).toMatchObject({ kind: 'human', id: 'victor' });
  });

  it('renders an approved plan', () => {
    const e = changelogEntry(row({ action: 'ticket.transition', details: { from: 'proposed', to: 'approved' } }), { ticketTitle: 'Add a changelog' })!;
    expect(e.kind).toBe('plan_approved');
    expect(e.summary).toBe('Plan approved: Add a changelog');
  });

  it('points a pull request entry at the pull request, not the ticket', () => {
    const e = changelogEntry(
      row({ action: 'ticket.work_product', entityType: 'ticket_work_product', details: { type: 'pull_request', url: 'https://example.invalid/pr/7' } }),
      { ticketTitle: 'Add a changelog' })!;
    expect(e.kind).toBe('pr_opened');
    expect(e.summary).toBe('Pull request opened for Add a changelog');
    expect(e.link).toEqual({ kind: 'url', target: 'https://example.invalid/pr/7' });
  });

  it('renders a landing with the mode it landed in', () => {
    const e = changelogEntry(row({ action: 'ticket.delivery_landed', details: { mode: 'fast-forward' } }), { ticketTitle: 'Add a changelog' })!;
    expect(e.kind).toBe('landed');
    expect(e.summary).toBe('Landed: Add a changelog (fast-forward)');
  });

  it('renders a cancellation with its reason', () => {
    const e = changelogEntry(row({ action: 'ticket.cancel', details: { from: 'todo', reason: 'already fixed on main' } }), { ticketTitle: 'Add a changelog' })!;
    expect(e.summary).toBe('Cancelled: Add a changelog — already fixed on main');
  });

  it('renders a hire, which is about a role rather than a ticket', () => {
    const e = changelogEntry(
      row({ action: 'role.hire', entityType: 'role', entityId: 'r1', ticketId: null, details: { project: 'api', autoActivate: true } }),
      { entityName: 'Backend Engineer' })!;
    expect(e).toMatchObject({ kind: 'hired', ticketId: null, ticketIdentifier: null, summary: 'Hired Backend Engineer for api', link: null });
  });

  it('renders a daemon upgrade, which belongs to no project', () => {
    const e = changelogEntry(row({
      action: 'daemon.upgraded', actorKind: 'system', actorId: null, entityType: 'daemon', entityId: 'u1',
      ticketId: null, projectId: null, details: { fromRelease: '2026-09-01-abc', toRelease: '2026-09-05-def' },
    }))!;
    expect(e).toMatchObject({ kind: 'upgraded', projectId: null, ticketId: null, link: null, summary: 'Daemon upgraded from 2026-09-01-abc to 2026-09-05-def' });
    expect(e.actor).toMatchObject({ kind: 'system', label: 'the daemon' });
  });

  // An old row whose service has since changed what it records must still read as something.
  it('degrades to a plainer line when the details are empty', () => {
    for (const action of ['ticket.create', 'ticket.delivery_landed', 'ticket.cancel', 'role.hire', 'daemon.upgraded']) {
      const e = changelogEntry(row({ action, details: {} }))!;
      expect(e).not.toBeNull();
      expect(e.summary).not.toBe('');
      expect(e.summary).not.toMatch(/undefined|null/);
    }
    expect(changelogEntry(row({ action: 'ticket.create', details: {} }))!.summary).toBe('Filed');
    expect(changelogEntry(row({ action: 'role.hire', details: {} }))!.summary).toBe('Hired a role');
  });

  it('returns null for a row that is not a changelog kind', () => {
    expect(changelogEntry(row({ action: 'ticket.checkout' }))).toBeNull();
  });
});

describe('day bucketing', () => {
  it('buckets an instant by the named timezone, not by UTC', () => {
    // 23:30 in Copenhagen on the 5th is 21:30 UTC on the 5th; in Auckland it is already the 6th.
    const at = '2026-09-05T21:30:00.000Z';
    expect(dayKey(at, 'UTC')).toBe('2026-09-05');
    expect(dayKey(at, 'Europe/Copenhagen')).toBe('2026-09-05');
    expect(dayKey(at, 'Pacific/Auckland')).toBe('2026-09-06');
  });

  it('puts an instant just after local midnight on the next day', () => {
    // 00:30 in Copenhagen on the 6th is 22:30 UTC on the 5th.
    expect(dayKey('2026-09-05T22:30:00.000Z', 'Europe/Copenhagen')).toBe('2026-09-06');
    expect(dayKey('2026-09-05T22:30:00.000Z', 'UTC')).toBe('2026-09-05');
  });

  it('starts a week on Monday and a month on its first', () => {
    expect(weekKey('2026-09-05')).toBe('2026-08-31');  // a Saturday, in the week of Monday the 31st
    expect(weekKey('2026-08-31')).toBe('2026-08-31');  // the Monday itself
    expect(weekKey('2026-08-30')).toBe('2026-08-24');  // a Sunday belongs to the week that began the 24th
    expect(monthKey('2026-09-05')).toBe('2026-09');
  });
});

describe('groupTimeline', () => {
  const at = (iso: string, id: string) => changelogEntry(row({ id, createdAt: iso }))!;

  it('groups newest-first entries into their days', () => {
    const groups = groupTimeline([
      at('2026-09-05T12:00:00.000Z', 'a'),
      at('2026-09-05T09:00:00.000Z', 'b'),
      at('2026-09-04T09:00:00.000Z', 'c'),
    ], 'UTC');
    expect(groups.map((g) => g.day)).toEqual(['2026-09-05', '2026-09-04']);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('marks the group that begins a week and the group that begins a month', () => {
    // Newest first across a month boundary (Sept 1 is a Tuesday) and a week boundary.
    const groups = groupTimeline([
      at('2026-09-02T09:00:00.000Z', 'a'),   // Wed, week of Aug 31, month 09
      at('2026-09-01T09:00:00.000Z', 'b'),   // Tue, week of Aug 31, month 09
      at('2026-08-31T09:00:00.000Z', 'c'),   // Mon, week of Aug 31, month 08
      at('2026-08-28T09:00:00.000Z', 'd'),   // Fri, week of Aug 24, month 08
    ], 'UTC');
    expect(groups.map((g) => [g.day, g.startsWeek, g.startsMonth])).toEqual([
      ['2026-09-02', false, false],
      ['2026-09-01', false, true],   // the oldest day of September in the list
      ['2026-08-31', true, false],   // the Monday that begins that week
      ['2026-08-28', true, true],    // the oldest group: begins both, as far as the list knows
    ]);
  });

  it('groups by the reader timezone, splitting a day UTC would have joined', () => {
    const groups = groupTimeline([
      at('2026-09-05T22:30:00.000Z', 'a'),   // already the 6th in Copenhagen
      at('2026-09-05T10:00:00.000Z', 'b'),   // still the 5th
    ], 'Europe/Copenhagen');
    expect(groups.map((g) => g.day)).toEqual(['2026-09-06', '2026-09-05']);
    expect(groupTimeline([at('2026-09-05T22:30:00.000Z', 'a'), at('2026-09-05T10:00:00.000Z', 'b')], 'UTC')).toHaveLength(1);
  });

  it('is empty for no entries', () => {
    expect(groupTimeline([], 'UTC')).toEqual([]);
  });
});
