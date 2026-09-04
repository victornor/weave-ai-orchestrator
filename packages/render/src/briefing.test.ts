import { describe, expect, it } from 'vitest';
import type { Briefing } from '@openconductor/shared';
import { briefingToSections } from './briefing.js';

const now = new Date('2026-09-04T12:00:00.000Z');

const full: Briefing = {
  needsYou: [{ decisionId: 'dec_1', ticketId: 'tkt_1', title: 'Approve the plan for ACME-42', kind: 'plan_approval', recommendation: 'Approve: the tasks match the proposal', createdAt: '2026-09-04T11:58:00.000Z' }],
  landed: [{ ticketId: 'tkt_0', identifier: 'ACME-41', title: 'Add tokens', completedAt: '2026-09-04T09:00:00.000Z', prUrl: 'https://example.com/pr/1' }],
  underway: [{ workerId: 'ag_1', workerName: 'Backend Engineer #7', ticketId: 'tkt_1', identifier: 'ACME-42', title: 'Theme tokens', status: 'in_progress', lastStatus: 'running vitest' }],
  queued: [{ ticketId: 'tkt_2', identifier: 'ACME-43', title: 'Docs pass', reason: 'role at max workers' }],
  warnings: ['project KB over budget'],
  generatedAt: '2026-09-04T12:00:00.000Z',
};

describe('briefingToSections', () => {
  it('always returns the four sections in order', () => {
    for (const input of [full, { needsYou: [], landed: [], underway: [], queued: [], warnings: [], generatedAt: '' } as Briefing, null, undefined]) {
      const out = briefingToSections(input, { now });
      expect(out.sections.map((s) => s.key)).toEqual(['needs-you', 'landed', 'underway', 'queued']);
      expect(out.sections).toHaveLength(4);
    }
  });

  it('renders items with glyphs and refs', () => {
    const out = briefingToSections(full, { now });
    expect(out.headline).toBe('1 decision waiting · 1 running · 1 landed');
    const [needs, landed, underway, queued] = out.sections;
    expect(needs.count).toBe(1);
    expect(needs.items[0]).toEqual({
      id: 'dec_1', uiStatus: 'needs-you', glyph: '◆',
      primary: 'Approve the plan for ACME-42',
      secondary: 'Recommended: Approve: the tasks match the proposal',
      meta: 'plan approval · 2m ago', ref: 'dec_1',
    });
    expect(landed.items[0]!.glyph).toBe('●');
    expect(underway.items[0]!.meta).toBe('ACME-42 · Backend Engineer #7 · in_progress');
    expect(queued.items[0]!.ref).toBe('ACME-43');
    expect(out.warnings).toEqual(['project KB over budget']);
  });

  it('carries empty-state lines that mention running workers', () => {
    const out = briefingToSections({ ...full, needsYou: [] }, { now });
    expect(out.sections[0]!.empty).toBe(true);
    expect(out.sections[0]!.emptyLine).toBe('Nothing needs you right now. 1 worker running.');
    expect(out.headline).toBe('Nothing needs you · 1 running · 1 landed');
  });

  it('has a plain empty line when nothing at all is running', () => {
    const out = briefingToSections(null, { now });
    expect(out.sections[0]!.emptyLine).toBe('Nothing needs you right now.');
    expect(out.sections[1]!.emptyLine).toBe('Nothing landed in this window.');
    expect(out.sections[2]!.emptyLine).toBe('No workers are running.');
    expect(out.sections[3]!.emptyLine).toBe('Nothing is waiting to start.');
  });

  it('survives malformed sections', () => {
    const out = briefingToSections({ needsYou: [null, undefined], underway: 'nope' } as unknown as Briefing, { now });
    expect(out.sections[0]!.count).toBe(0);
    expect(out.sections[2]!.count).toBe(0);
  });
});
