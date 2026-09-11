/**
 * `conductor ticket show`'s delivery line (VS-250). The VS-227 shape — a merged pull request with
 * no merge-done record — used to be invisible from the CLI because `delivery` was never printed;
 * this formatter names the gap, prints a complete merge's commit, and omits anything else.
 */
import { describe, expect, it } from 'vitest';
import type { Ticket } from '@agent-conductor/shared';
import { deliveryShowValue } from './ticket.js';

const done = (delivery: Ticket['delivery']): Pick<Ticket, 'status' | 'delivery'> => ({ status: 'done', delivery });

describe('deliveryShowValue', () => {
  it('names an incomplete merged delivery that still has a PR url', () => {
    expect(deliveryShowValue(done({ prUrl: 'https://example.com/pull/190', prState: 'merged' }))).toBe('incomplete — merged PR, no mergeCommit');
  });

  it('names an incomplete delivery with no PR url', () => {
    expect(deliveryShowValue(done({ merged: true }))).toBe('incomplete — merged, no mergeCommit');
  });

  it("prints merge-done's commit for a complete delivery", () => {
    expect(deliveryShowValue(done({ merged: true, mergeCommit: 'a'.repeat(40) }))).toBe('a'.repeat(40));
  });

  it('omits the row for a no-diff ending or a pull request that is not merged', () => {
    expect(deliveryShowValue(done(null))).toBeUndefined();
    expect(deliveryShowValue(done({ branch: 'ac/acme-42' }))).toBeUndefined();
    expect(deliveryShowValue(done({ prUrl: 'https://example.com/pull/7', prState: 'open' }))).toBeUndefined();
  });
});
