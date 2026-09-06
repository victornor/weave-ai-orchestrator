import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '../api/types';
import { buildModel } from '../lib/graph/model';
import { edgeDimmed, highlighted, matchingIds, nodeDimmed, visible } from '../lib/graph/filters';

const GRAPH: KnowledgeGraph = {
  nodes: [
    { id: 'api/hub', kind: 'hub', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: null, title: 'API knowledge', tokens: 900, updatedAt: '' },
    { id: 'api/payments', kind: 'doc', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'payments', title: 'Payments webhooks', tokens: 400, updatedAt: '' },
    { id: 'api/billing', kind: 'doc', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'billing', title: 'Billing runbook', tokens: 300, updatedAt: '' },
    { id: 'SHARED.md', kind: 'hub', scope: 'shared', projectId: null, projectSlug: null, slug: null, title: 'Shared conventions', tokens: 200, updatedAt: '' },
  ],
  edges: [
    { from: 'api/hub', to: 'api/payments' },
    { from: 'api/hub', to: 'api/billing' },
    { from: 'SHARED.md', to: 'api/hub' },
  ],
};

const model = buildModel(GRAPH);

describe('matchingIds', () => {
  it('is null when nothing is being searched for', () => {
    expect(matchingIds(model, '   ')).toBeNull();
  });

  it('matches titles case-insensitively on a substring', () => {
    expect([...matchingIds(model, 'BILL')!]).toEqual(['api/billing']);
    expect([...matchingIds(model, 'OOK')!].sort()).toEqual(['api/billing', 'api/payments']);
  });

  it('dims everything that does not match and moves nothing', () => {
    const matches = matchingIds(model, 'billing')!;
    expect(nodeDimmed('api/billing', null, matches)).toBe(false);
    expect(nodeDimmed('api/payments', null, matches)).toBe(true);
    expect(visible(model, new Set()).nodes).toHaveLength(4);
  });
});

describe('visible', () => {
  it('drops a hidden group and every edge that touched it', () => {
    const v = visible(model, new Set(['shared']));
    expect(v.nodes.map((n) => n.id)).toEqual(['api/hub', 'api/payments', 'api/billing']);
    expect(v.groups).toEqual(['api']);
    expect(v.edges.some((e) => e.source === 'SHARED.md' || e.target === 'SHARED.md')).toBe(false);
    expect(v.edges).toHaveLength(2);
  });

  it('leaves nothing when every group is hidden', () => {
    const v = visible(model, new Set(['api', 'shared']));
    expect(v.nodes).toHaveLength(0);
    expect(v.edges).toHaveLength(0);
  });
});

describe('highlighted', () => {
  it('is the focused node and its direct neighbours', () => {
    expect([...highlighted(model, 'api/hub')!].sort()).toEqual(['SHARED.md', 'api/billing', 'api/hub', 'api/payments']);
  });

  it('is null with no focus and for a node the model does not know', () => {
    expect(highlighted(model, null)).toBeNull();
    expect(highlighted(model, 'nope')).toBeNull();
  });

  it('dims every node and edge outside the neighbourhood', () => {
    const lit = highlighted(model, 'api/payments')!;
    expect(nodeDimmed('api/payments', lit, null)).toBe(false);
    expect(nodeDimmed('api/hub', lit, null)).toBe(false);
    expect(nodeDimmed('api/billing', lit, null)).toBe(true);

    const toBilling = model.edges.find((e) => e.target === 'api/billing' || e.source === 'api/billing')!;
    expect(edgeDimmed(toBilling, lit, null)).toBe(true);
    const toPayments = model.edges.find((e) => e.target === 'api/payments' || e.source === 'api/payments')!;
    expect(edgeDimmed(toPayments, lit, null)).toBe(false);
  });

  it('composes with a search: only the matching part of the neighbourhood stays lit', () => {
    const lit = highlighted(model, 'api/hub')!;
    const matches = matchingIds(model, 'payments')!;
    expect(nodeDimmed('api/payments', lit, matches)).toBe(false);
    expect(nodeDimmed('api/billing', lit, matches)).toBe(true);
    expect(nodeDimmed('api/hub', lit, matches)).toBe(true);
  });
});
