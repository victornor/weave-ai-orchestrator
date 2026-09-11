import { describe, expect, it } from 'vitest';
import { incompleteDelivery, landingBranchOf, type Ticket } from './types.js';

const done = (delivery: Ticket['delivery']): Pick<Ticket, 'status' | 'delivery'> => ({ status: 'done', delivery });

describe('incompleteDelivery', () => {
  it("flags the VS-227 shape: a merged pull request with neither merge-done's flag nor a commit", () => {
    expect(incompleteDelivery(done({ prUrl: 'https://example.com/pull/190', prState: 'merged' }))).toBe(true);
  });

  it('accepts merge-done\'s complete record', () => {
    expect(incompleteDelivery(done({ merged: true, mergeCommit: 'a'.repeat(40), method: 'squash' }))).toBe(false);
  });

  it('flags merged: true without a recorded commit', () => {
    expect(incompleteDelivery(done({ merged: true }))).toBe(true);
    expect(incompleteDelivery(done({ merged: true, mergeCommit: null }))).toBe(true);
    expect(incompleteDelivery(done({ merged: true, mergeCommit: '' }))).toBe(true);
    expect(incompleteDelivery(done({ merged: true, mergeCommit: '   ' }))).toBe(true);
  });

  it('leaves a no-diff ending alone', () => {
    expect(incompleteDelivery(done(null))).toBe(false);
    expect(incompleteDelivery(done({}))).toBe(false);
    expect(incompleteDelivery(done({ prUrl: 'https://example.com/pull/7', prState: 'open' }))).toBe(false);
    expect(incompleteDelivery(done({ branch: 'ac/acme-42' }))).toBe(false);
  });

  it('only applies to done tickets', () => {
    expect(incompleteDelivery({ status: 'merging', delivery: { prUrl: 'u', prState: 'merged' } })).toBe(false);
    expect(incompleteDelivery({ status: 'cancelled', delivery: { prUrl: 'u', prState: 'merged' } })).toBe(false);
  });
});

describe('landingBranchOf', () => {
  it('falls back to the project default branch when neither the project nor the ticket declares one', () => {
    expect(landingBranchOf({ defaultBranch: 'main', landingBranch: null })).toBe('main');
    expect(landingBranchOf({ defaultBranch: 'main', landingBranch: null }, { landingBranch: null })).toBe('main');
  });

  it('uses the project landing branch when the project declares one and the ticket does not', () => {
    expect(landingBranchOf({ defaultBranch: 'main', landingBranch: 'edge' })).toBe('edge');
    expect(landingBranchOf({ defaultBranch: 'main', landingBranch: 'edge' }, { landingBranch: null })).toBe('edge');
    expect(landingBranchOf({ defaultBranch: 'main', landingBranch: 'edge' }, undefined)).toBe('edge');
  });

  it("the ticket's own declaration overrides the project's landing branch", () => {
    expect(landingBranchOf({ defaultBranch: 'main', landingBranch: 'edge' }, { landingBranch: 'main' })).toBe('main');
  });

  it("the ticket's own declaration overrides even when the project declares no landing branch", () => {
    expect(landingBranchOf({ defaultBranch: 'main', landingBranch: null }, { landingBranch: 'hotfix' })).toBe('hotfix');
  });
});
