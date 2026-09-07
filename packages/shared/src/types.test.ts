import { describe, expect, it } from 'vitest';
import { landingBranchOf } from './types.js';

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
