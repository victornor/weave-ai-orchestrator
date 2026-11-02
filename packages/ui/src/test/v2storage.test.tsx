/** VS-955: Settings → Workspace → Storage — the retained worker copies, the disk line and the reclaim offer. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetainedCopiesReport, RetainedCopy } from '@weave-ai/shared';
import { StorageSection } from '../v2/settings/sections/Storage';

const GB = 1024 ** 3;

function copy(over: Partial<RetainedCopy>): RetainedCopy {
  return {
    directory: 'w1', workerId: 'w1', workerName: 'Engineer #1', workerStatus: 'done', ticketId: 't1', ticketIdentifier: 'VS-349',
    ticketStatus: 'cancelled', projectId: 'p1', branch: 'ac/vs-349-x', headSha: 'abc', class: 'finished_unlanded', offerable: true,
    ageFrom: new Date(Date.now() - 50 * 86_400_000).toISOString(), bytes: 12 * GB, uncommitted: { tracked: 2, untracked: 3 },
    commitsNotOnLandingBranch: 0, commitsOnNoRemote: 0, commitsOnlyHere: 0, mergedPr: false, error: null, reasons: ['uncommitted'],
    needsOwnApproval: false, scannedAt: '2026-11-02T19:00:00.000Z', ...over,
  };
}

const state = vi.hoisted(() => ({
  report: null as unknown as RetainedCopiesReport,
  scans: 0,
  offers: [] as string[][],
}));

vi.mock('../api/hooks', () => ({
  useRetainedCopies: () => ({ data: state.report, isLoading: false, isError: false }),
  useRetainedScan: () => ({ mutate: () => { state.scans += 1; }, isPending: false }),
  useOfferReclaim: () => ({
    isPending: false,
    mutateAsync: async (dirs: string[]) => {
      state.offers.push(dirs);
      return { cards: [{ decisionId: 'd1', directories: ['w2'], bytes: 4 * GB, own: true }, { decisionId: 'd2', directories: ['w1', 'w3'], bytes: 14 * GB, own: false }], skipped: [] };
    },
  }),
}));

beforeEach(() => {
  state.scans = 0;
  state.offers = [];
  const copies = [
    copy({}),
    copy({ directory: 'w2', ticketIdentifier: 'VS-350', bytes: 4 * GB, reasons: ['commits_not_on_landing_branch'], uncommitted: { tracked: 0, untracked: 0 },
      commitsNotOnLandingBranch: 4, commitsOnNoRemote: 1, needsOwnApproval: true }),
    copy({ directory: 'w3', ticketIdentifier: 'VS-351', bytes: 2 * GB, ticketStatus: 'done', uncommitted: { tracked: 0, untracked: 1 } }),
    copy({ directory: 'w4', ticketIdentifier: 'VS-900', ticketStatus: 'in_review', class: 'open', offerable: false, bytes: 1 * GB }),
  ];
  state.report = {
    scannedAt: '2026-11-02T19:00:00.000Z', scanning: false, offerDays: 30,
    totals: {
      count: 4, bytes: 19 * GB, offerable: { count: 3, bytes: 18 * GB },
      byClass: { open: { count: 1, bytes: GB }, finished_unlanded: { count: 3, bytes: 18 * GB }, branch_gone: { count: 0, bytes: 0 }, orphan: { count: 0, bytes: 0 } },
    },
    copies,
    disk: { path: '/home/v/ws', freeBytes: 24 * GB, totalBytes: 1600 * GB, low: true, thresholds: { freePercent: 10, freeBytes: 50 * GB }, checkedAt: 't' },
  };
});

describe('StorageSection (VS-955)', () => {
  it('shows the disk line, the totals and every copy with its size, class and why it is kept', () => {
    render(<StorageSection />);
    expect(screen.getByText(/24GB free of 1\.6TB \(2%\) on the filesystem holding/)).toBeInTheDocument();
    expect(screen.getByText(/below the warning threshold/)).toBeInTheDocument();
    expect(screen.getByText('4 copies, 19GB')).toBeInTheDocument();
    const row = (dir: string) => within(document.querySelector(`[data-retained-copy="${dir}"]`) as HTMLElement);
    expect(row('w1').getByText('12GB')).toBeInTheDocument();
    expect(row('w1').getByText('2 modified, 3 untracked')).toBeInTheDocument();
    expect(row('w2').getByText('4 commits not landed (1 unpushed)')).toBeInTheDocument();
    expect(row('w2').getByText('own card')).toBeInTheDocument();
    expect(row('w4').getByText('ticket open')).toBeInTheDocument();
    expect(row('w4').getByRole('checkbox')).toBeDisabled();
  });

  it('selects the offerable copies, shows the card split, and sends only after confirming', async () => {
    render(<StorageSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Select offerable (3)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Offer reclaim (3, 18GB)' }));
    expect(state.offers).toEqual([]);
    expect(screen.getByText(/raises 2 approval cards and removes nothing: 1 of their own .* and one shared card for 2 copies/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Raise the cards' }));
    await waitFor(() => expect(state.offers).toEqual([['w1', 'w2', 'w3']]));
    expect(await screen.findByText(/2 cards raised in Needs you; nothing has been removed\./)).toBeInTheDocument();
  });

  it('rescans on request', () => {
    render(<StorageSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    expect(state.scans).toBe(1);
  });
});
