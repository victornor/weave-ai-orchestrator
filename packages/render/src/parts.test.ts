import { describe, expect, it } from 'vitest';
import { decisionCardPartsOf, planArtifactCardPartsOf } from './parts.js';

const card = {
  type: 'card',
  title: 'File this as a ticket?',
  body: 'It is a one-line fix.',
  actions: [
    { key: 'file', label: 'File it', style: 'primary' },
    { key: 'skip', label: 'Leave it', style: 'default' },
  ],
  ref: { kind: 'decision', id: 'd1' },
};

describe('decisionCardPartsOf', () => {
  it('picks a decision card out of a mixed parts array, with its actions and ref', () => {
    const parts = [{ type: 'text', text: 'before' }, card, { type: 'attachment', id: 'a1', filename: 'x', mediaType: 'text/plain', byteSize: 1 }];
    expect(decisionCardPartsOf(parts)).toEqual([card]);
  });

  it('returns an empty array for null, undefined or a non-array', () => {
    expect(decisionCardPartsOf(null)).toEqual([]);
    expect(decisionCardPartsOf(undefined)).toEqual([]);
    expect(decisionCardPartsOf('nope' as unknown as unknown[])).toEqual([]);
  });

  it('drops malformed parts and cards with no decision ref', () => {
    const parts = [
      null,
      'text',
      { type: 'card', title: 't', body: 'b', actions: [] },
      { type: 'card', title: 't', body: 'b', actions: [], ref: { kind: 'other', id: 'x' } },
      { type: 'card', title: 't', body: 'b', actions: [], ref: { kind: 'decision' } },
      { type: 'card', title: 't', body: 'b', ref: { kind: 'decision', id: 'd1' } },
      card,
    ];
    expect(decisionCardPartsOf(parts)).toEqual([card]);
  });
});

const planArtifact = {
  type: 'card',
  title: 'Ticket graph',
  body: 'How the drafts depend on one another.',
  actions: [{ key: 'open', label: 'Open artifact', style: 'primary' }],
  ref: { kind: 'plan-artifact', planId: 'p1', key: 'ticket-graph', revision: 2 },
};

describe('planArtifactCardPartsOf', () => {
  it('picks a plan-artifact card out of a mixed parts array', () => {
    const parts = [{ type: 'text', text: 'here' }, planArtifact, card];
    expect(planArtifactCardPartsOf(parts)).toEqual([planArtifact]);
  });

  it('returns an empty array for null, undefined or a non-array', () => {
    expect(planArtifactCardPartsOf(null)).toEqual([]);
    expect(planArtifactCardPartsOf(undefined)).toEqual([]);
    expect(planArtifactCardPartsOf('nope' as unknown as unknown[])).toEqual([]);
  });

  it('drops a decision card and malformed plan-artifact cards', () => {
    const parts = [
      card,
      { type: 'card', title: 't', body: 'b', actions: [], ref: { kind: 'plan-artifact', planId: 'p1', key: 'k' } },
      { type: 'card', title: 't', body: 'b', actions: [], ref: { kind: 'plan-artifact', planId: 'p1', key: 'k', revision: '1' } },
      planArtifact,
    ];
    expect(planArtifactCardPartsOf(parts)).toEqual([planArtifact]);
  });
});
