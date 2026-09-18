import { describe, expect, it } from 'vitest';
import { deliveryBadgeOf, type Project, type Ticket } from './types.js';

const project = (landingBranch: string | null): Pick<Project, 'defaultBranch' | 'landingBranch'> => ({ defaultBranch: 'main', landingBranch });
const ticket = (over: Partial<Pick<Ticket, 'status' | 'landingBranch' | 'delivery'>> = {}): Pick<Ticket, 'status' | 'landingBranch' | 'delivery'> =>
  ({ status: 'done', landingBranch: null, delivery: { merged: true, landedOn: 'edge' }, ...over });

describe('deliveryBadgeOf (VS-568)', () => {
  it('reads on the actual landing branch until promoted', () => {
    expect(deliveryBadgeOf(project('edge'), ticket())).toEqual({ state: 'on_landing', branch: 'edge' });
  });
  it('reads in production once a promotion included it', () => {
    expect(deliveryBadgeOf(project('edge'), ticket({ delivery: { merged: true, landedOn: 'edge', promotedAt: '2026-09-18T00:00:00Z' } }))).toEqual({ state: 'in_production', branch: 'main' });
  });
  it('reads in production for a hotfix that landed on the default branch', () => {
    expect(deliveryBadgeOf(project('edge'), ticket({ landingBranch: 'main', delivery: { merged: true, landedOn: 'main' } }))).toEqual({ state: 'in_production', branch: 'main' });
  });
  it('says nothing for a project that lands on its default branch, or a ticket that has not landed', () => {
    expect(deliveryBadgeOf(project(null), ticket({ delivery: { merged: true, landedOn: 'main' } }))).toBeNull();
    expect(deliveryBadgeOf(project('edge'), ticket({ status: 'merging' }))).toBeNull();
    expect(deliveryBadgeOf(project('edge'), ticket({ delivery: {} }))).toBeNull();
  });
});
