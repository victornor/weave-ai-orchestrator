/** VS-584: the project's promotion surface shows the honest content, the pull request's progress, and a hold. */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ProjectPromotion } from '../../api/hooks';
import { PromoteControl } from './ProjectPage';

const state = vi.hoisted(() => ({ data: null as ProjectPromotion | null }));
vi.mock('../../api/hooks', () => ({
  useProjectPromotion: () => ({ data: state.data }),
  useRequestPromotion: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
}));
vi.mock('../../api/context', () => ({ useWs: () => 'ws1' }));

const base = (over: Partial<ProjectPromotion> = {}): ProjectPromotion => ({
  applicable: true, landing: 'edge', defaultBranch: 'main', ahead: 12, behind: 0,
  changedFiles: 59, additions: 1200, deletions: 300, strategy: 'pull-request', promotion: null,
  tickets: [{ id: 't1', identifier: 'FS-12', title: 'Add a thing' }], canPromote: true, heldReason: null, notes: [],
  ...over,
});

describe('PromoteControl (VS-584)', () => {
  it('shows the changed files and tickets instead of a commit count', () => {
    state.data = base();
    const { container } = render(<PromoteControl projectId="p1" />);
    expect(container.textContent).toContain('59 files changed');
    expect(container.textContent).toContain('via pull request');
    expect(container.textContent).toContain('FS-12');
    expect(container.textContent).not.toContain('12 commits ahead');
  });

  it('links the promotion pull request while its checks run', () => {
    state.data = base({ promotion: { state: 'pending', prUrl: 'https://example.com/pr/530', mergeMethod: 'squash', heldReason: null, updatedAt: '2026-09-19T00:00:00Z' }, canPromote: false });
    const { container } = render(<PromoteControl projectId="p1" />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/pr/530');
    expect(container.textContent).toContain('checks running');
    // No second Promote while one is in flight.
    expect(container.querySelector('button')).toBeNull();
  });

  it('names the reason a held promotion cannot proceed', () => {
    state.data = base({ canPromote: false, promotion: { state: 'held', prUrl: 'https://example.com/pr/530', mergeMethod: 'squash', heldReason: 'required checks failed on the promotion pull request', updatedAt: '2026-09-19T00:00:00Z' } });
    const { container } = render(<PromoteControl projectId="p1" />);
    expect(container.textContent).toContain('required checks failed');
    expect(container.textContent).toContain('Promote edge to main');
  });
});
