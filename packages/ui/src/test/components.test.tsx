import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UI_STATUSES } from '@agent-conductor/shared';
import { StatusGlyph, StatusBadge } from '../components/StatusGlyph';
import { TicketCard } from '../components/TicketCard';
import { WorkerCard } from '../components/WorkerCard';
import { DecisionCard } from '../components/DecisionCard';
import { DispatchLabel } from '../components/DispatchLabel';
import { Composer } from '../components/Composer';
import { BudgetMeter } from '../components/BudgetMeter';
import { TOTPInput } from '../components/TOTPInput';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { EmptyState, ErrorState } from '../components/States';
import { ApiError } from '../api/client';
import { PlanPreview } from '../components/PlanPreview';
import { MergeQueueBadge, MergeQueueStrip } from '../components/MergeQueue';
import { agent, decision, ticket } from './factories';

const planDoc = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('../api/hooks', () => ({
  useTicketDocument: () => planDoc.current ?? { data: undefined, isLoading: false, isError: true },
}));

describe('StatusGlyph', () => {
  it('renders one accessible glyph per status token', () => {
    for (const s of UI_STATUSES) {
      const { unmount } = render(<StatusGlyph status={s} />);
      expect(screen.getByRole('img')).toHaveAccessibleName(s === 'needs-you' ? 'needs you' : s);
      unmount();
    }
  });

  it('labels the badge', () => {
    render(<StatusBadge status="working" />);
    expect(screen.getByText('working')).toBeInTheDocument();
  });
});

describe('TicketCard', () => {
  it('shows the identifier, title and kind', () => {
    render(<TicketCard ticket={ticket()} />);
    expect(screen.getByText('ACME-42')).toBeInTheDocument();
    expect(screen.getByText('Dark mode for the dashboard')).toBeInTheDocument();
    expect(screen.getByText('change')).toBeInTheDocument();
  });

  it('prints the exact status when the card was folded into a neighbouring column', () => {
    render(<TicketCard ticket={ticket({ status: 'merging' })} />);
    expect(screen.getByText('merging')).toBeInTheDocument();
  });

  it('does not print a sub-status for a status that owns its column', () => {
    render(<TicketCard ticket={ticket({ status: 'in_progress' })} />);
    expect(screen.queryByText('in progress')).not.toBeInTheDocument();
  });

  it('reads as working, names the worker and keeps its real status when a worker is live on it', () => {
    render(<TicketCard ticket={ticket({ status: 'todo' })} working workerName="Platform Engineer #21" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('working');
    expect(screen.getByText('todo')).toBeInTheDocument();
    expect(screen.getByText('Platform Engineer #21')).toBeInTheDocument();
  });

  it('marks a merging ticket merging, not needs-you, so it does not read like one waiting for review', () => {
    render(<TicketCard ticket={ticket({ status: 'merging' })} working />);
    expect(screen.getByRole('img')).toHaveAccessibleName('merging');
    const { unmount } = render(<TicketCard ticket={ticket({ status: 'in_review' })} />);
    expect(screen.getAllByRole('img').at(-1)).toHaveAccessibleName('needs you');
    unmount();
  });

  it('leaves a proposed ticket with a live worker needing you', () => {
    render(<TicketCard ticket={ticket({ status: 'proposed' })} working />);
    expect(screen.getByRole('img')).toHaveAccessibleName('needs you');
    expect(screen.queryByText('proposed')).not.toBeInTheDocument();
  });

  it('reads as auto-approving rather than needs-you when the daemon will grant the approval', () => {
    render(<TicketCard ticket={ticket({ status: 'in_review' })} needsYou autoApproving />);
    expect(screen.getByText('auto-approving')).toBeInTheDocument();
    expect(screen.getByRole('img')).not.toHaveAccessibleName('needs you');
  });

  it('still reads as needs-you when the human owns the approval', () => {
    render(<TicketCard ticket={ticket({ status: 'in_review' })} needsYou />);
    expect(screen.queryByText('auto-approving')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('needs you');
  });
});

describe('TicketCard — a paused worker', () => {
  it('says on the board why the work stopped', () => {
    render(<TicketCard ticket={ticket()} workerName="Frontend Engineer #7" workerPausedFor="provider_quota · limit resets in 2 hours" />);
    expect(screen.getByText('paused · provider_quota · limit resets in 2 hours')).toBeInTheDocument();
  });

  it('says nothing when the worker is not paused', () => {
    render(<TicketCard ticket={ticket()} workerName="Frontend Engineer #7" />);
    expect(screen.queryByText(/paused ·/)).not.toBeInTheDocument();
  });
});

describe('WorkerCard', () => {
  // VS-56: a paused worker says why, and offers the one action that puts it back to work.
  it('names why a paused worker stopped and offers Resume', () => {
    const resume = vi.fn();
    render(
      <WorkerCard
        agent={agent({
          status: 'paused',
          pauseReason: 'rate_limit: waiting for a human',
          pauseDetail: { family: 'provider_quota', code: 'rate_limit', message: 'limit resets in 2 hours', resetAt: null, runId: 'r1' },
        })}
        onResume={resume}
      />,
    );
    expect(screen.getByText('provider_quota · limit resets in 2 hours')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('renders a worker paused with only a free-text reason, and none for a running one', () => {
    const { unmount } = render(<WorkerCard agent={agent({ status: 'paused', pauseReason: 'paused by operator' })} />);
    expect(screen.getByText('paused by operator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    unmount();

    render(<WorkerCard agent={agent()} />);
    expect(screen.queryByText(/provider_quota/)).not.toBeInTheDocument();
  });

  it('shows the last line and the worktree state', () => {
    render(
      <WorkerCard
        agent={agent()}
        projectSlug="web"
        ticketIdentifier="ACME-42"
        lastLine="running vitest — 38/41 passed"
        worktree={{ status: 'active', dirty: true, ahead: 3, behind: 0 }}
        usage={{ tokens: 18400, costCents: 41, estimated: true }}
      />,
    );
    expect(screen.getByText('Frontend Engineer #7')).toBeInTheDocument();
    expect(screen.getByText('running vitest — 38/41 passed')).toBeInTheDocument();
    expect(screen.getByText('↑3 ↓0')).toBeInTheDocument();
    expect(screen.getByText('18.4k tok')).toBeInTheDocument();
    expect(screen.getByText('$0.41 est')).toBeInTheDocument();
  });
});

describe('DispatchLabel', () => {
  it('names the work and the state it is in', () => {
    render(<DispatchLabel identifier="ACME-42" name="Frontend Engineer #7" status="working" />);
    expect(screen.getByText('ACME-42')).toBeInTheDocument();
    expect(screen.getByText('Frontend Engineer #7')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('keeps reading truthfully once the work has ended', () => {
    const { rerender } = render(<DispatchLabel identifier="ACME-42" name="Frontend Engineer #7" status="done" />);
    expect(screen.getByRole('button', { name: 'ACME-42: Frontend Engineer #7 — done' })).toBeInTheDocument();
    rerender(<DispatchLabel identifier="ACME-42" name="Frontend Engineer #7" status="failed" />);
    expect(screen.getByRole('button', { name: 'ACME-42: Frontend Engineer #7 — failed' })).toBeInTheDocument();
  });

  it('is a way in', () => {
    const onClick = vi.fn();
    render(<DispatchLabel identifier="ACME-42" name="Frontend Engineer #7" status="done" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

const question = (over: Partial<Parameters<typeof decision>[0]> = {}): ReturnType<typeof decision> =>
  decision({
    kind: 'question',
    options: [
      { key: 'local', label: 'localStorage + system fallback', description: 'No backend change.', recommended: true },
      { key: 'user', label: 'Persist on the user record', description: 'Needs a migration.' },
    ],
    ...over,
  });

describe('DecisionCard', () => {
  it('renders the plan variant with Approve / Revise / reject', () => {
    render(<DecisionCard decision={decision()} ticketIdentifier="ACME-42" onAnswer={() => undefined} />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revise/ })).toBeInTheDocument();
    expect(screen.getByText('ThemeProvider + OS fallback')).toBeInTheDocument();
  });

  it('renders the plan slot on a plan approval only', () => {
    const { unmount } = render(<DecisionCard decision={decision()} plan={<p>the rendered plan</p>} onAnswer={() => undefined} />);
    expect(screen.getByText('the rendered plan')).toBeInTheDocument();
    unmount();
    render(<DecisionCard decision={decision({ kind: 'merge_approval' })} plan={<p>the rendered plan</p>} onAnswer={() => undefined} />);
    expect(screen.queryByText('the rendered plan')).not.toBeInTheDocument();
  });

  it('answers with the approve key', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={decision()} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(onAnswer).toHaveBeenCalledWith({ key: 'approve' });
  });

  it('marks the recommended option PICKED on a worker question', () => {
    render(<DecisionCard decision={question()} onAnswer={() => undefined} />);
    expect(screen.getByText('PICKED')).toBeInTheDocument();
    expect(screen.getByText('Write your own…')).toBeInTheDocument();
  });

  it('renders each option of a two-option question exactly once', () => {
    render(<DecisionCard decision={question()} onAnswer={() => undefined} />);
    expect(screen.getAllByText('localStorage + system fallback')).toHaveLength(1);
    expect(screen.getAllByText('Persist on the user record')).toHaveLength(1);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('selects an option without answering, and sends the last selection', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={question()} onAnswer={onAnswer} />);
    const send = screen.getByRole('button', { name: 'Send answer' });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /localStorage/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /localStorage/ })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: /user record/ }));
    expect(screen.getByRole('radio', { name: /localStorage/ })).not.toBeChecked();
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(send);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ key: 'user' });
  });

  it('answers with free text from the write-your-own composer', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={question()} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('Write your own…'));
    const box = screen.getByLabelText('Answer in your own words…');
    fireEvent.change(box, { target: { value: 'neither — put it behind a flag' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith({ text: 'neither — put it behind a flag' });
  });

  it('offers no free-text alternative when the decision forbids one', () => {
    render(<DecisionCard decision={question({ allowFreeText: false })} onAnswer={() => undefined} />);
    expect(screen.queryByText('Write your own…')).not.toBeInTheDocument();
  });

  it('names the conductor as the asker of a conductor question', () => {
    render(<DecisionCard decision={question()} asker="conductor" onAnswer={() => undefined} />);
    expect(screen.getByText('Conductor asks')).toBeInTheDocument();
  });

  it('keeps the worker heading for a worker question', () => {
    render(<DecisionCard decision={question()} asker="worker" onAnswer={() => undefined} />);
    expect(screen.getByText('Worker question')).toBeInTheDocument();
  });

  it('renders an answered decision as an inert record of the option chosen', () => {
    const onAnswer = vi.fn();
    render(
      <DecisionCard
        decision={question({ status: 'answered', answerKey: 'user', answeredAt: '2026-09-01T10:15:00.000Z' })}
        asker="conductor"
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.getByText('Persist on the user record')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send answer' })).not.toBeInTheDocument();
    expect(screen.queryByText('Write your own…')).not.toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('shows the words when the answer was written rather than picked', () => {
    render(
      <DecisionCard
        decision={question({ status: 'answered', answerKey: null, answerText: 'neither — put it behind a flag' })}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText('neither — put it behind a flag')).toBeInTheDocument();
  });

  it('offers nothing to answer on an answered plan approval', () => {
    render(<DecisionCard decision={decision({ status: 'answered', answerKey: 'approve' })} onAnswer={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('keeps the destructive variant disabled until the identifier is typed', () => {
    render(<DecisionCard decision={decision({ kind: 'discard_approval' })} ticketIdentifier="ACME-42" onAnswer={() => undefined} />);
    const discard = screen.getByRole('button', { name: 'Discard' });
    expect(discard).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type the ticket identifier to confirm'), { target: { value: 'ACME-42' } });
    expect(discard).toBeEnabled();
  });
});

describe('Composer', () => {
  it('submits on Enter and clears', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…');
    fireEvent.change(box, { target: { value: 'add dark mode' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('add dark mode');
  });

  it('explains the queued state when the conductor is mid-turn', () => {
    render(<Composer onSubmit={() => undefined} queuedReason="Conductor is replying — your message is queued" queuedCount={1} />);
    expect(screen.getByText('Conductor is replying — your message is queued')).toBeInTheDocument();
    expect(screen.getByText('1 queued')).toBeInTheDocument();
  });

  it('keeps the mic visible and dimmed when dictation is unavailable', () => {
    render(<Composer onSubmit={() => undefined} />);
    const mic = screen.getByLabelText('Dictation unavailable');
    fireEvent.click(mic);
    expect(screen.getByText(/Dictation is unavailable/)).toBeInTheDocument();
  });

  it('stops growing at its cap, scrolls to the last line, and keeps the send control', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message the conductor…" />);
    const box = growable(screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement, 420);

    fireEvent.change(box, { target: { value: 'a\n'.repeat(40) } });

    // Capped rather than pushing the row taller, and scrolled to the bottom so the last line shows.
    expect(box.style.height).toBe('192px');
    expect(box.scrollTop).toBe(420);
    expect(screen.getByLabelText('Send')).toBeInTheDocument();
  });

  it('follows text appended without a keystroke, the way dictation adds it', () => {
    const { rerender } = render(<Composer onSubmit={() => undefined} value="one" onChange={() => undefined} placeholder="Message the conductor…" />);
    const box = growable(screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement, 420);

    rerender(<Composer onSubmit={() => undefined} value="one two three" onChange={() => undefined} placeholder="Message the conductor…" />);

    expect(box.scrollTop).toBe(420);
  });

  // jsdom has no layout: scrollHeight is always 0 and scrollTop never moves. These stand in for the
  // measurements a browser would make, so the autosize effect can be observed at all.
  function growable(el: HTMLTextAreaElement, scrollHeight: number): HTMLTextAreaElement {
    let top = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    return el;
  }
});

describe('BudgetMeter', () => {
  it('turns amber at curation due', () => {
    render(<BudgetMeter label="web · project KB" used={11400} budget={12000} curationPending />);
    expect(screen.getByText('curation due')).toBeInTheDocument();
    expect(screen.getByText('11.4k / 12.0k tok')).toBeInTheDocument();
  });
});

describe('TOTPInput', () => {
  it('fills all six boxes from a paste', () => {
    let value = '';
    const onChange = vi.fn((v: string) => {
      value = v;
    });
    render(<TOTPInput value="" onChange={onChange} />);
    fireEvent.paste(screen.getByLabelText('Digit 1'), { clipboardData: { getData: () => '407219' } });
    expect(onChange).toHaveBeenCalledWith('407219');
    expect(value).toBe('407219');
  });
});

describe('ConnectionBanner', () => {
  it('shows nothing when connected', () => {
    const { container } = render(<ConnectionBanner state="connected" capturedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the capture time when offline', () => {
    render(<ConnectionBanner state="offline" capturedAt="2026-09-01T09:38:00.000Z" queuedCount={2} />);
    expect(screen.getByText(/Offline — showing the state from/)).toBeInTheDocument();
    expect(screen.getByText('2 queued')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('empty state is one sentence plus what is true instead', () => {
    render(<EmptyState title="Nothing needs you right now." detail="3 workers running." />);
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.getByText('3 workers running.')).toBeInTheDocument();
  });

  it('error state shows the typed code and a next step', () => {
    render(<ErrorState error={new ApiError(503, { code: 'runtime_unreachable', message: 'The claude-code runtime did not answer in 30s.' })} onRetry={() => undefined} />);
    expect(screen.getByText('RUNTIME_UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('PlanPreview', () => {
  const doc = (body: string): Record<string, unknown> => ({ data: { key: 'plan', revision: 2, body, createdAt: '' }, isLoading: false, isError: false });

  it('opens the plan from the approval control without leaving it', () => {
    planDoc.current = doc('# Plan for dark-mode\n\n## Proposal\n\nSemantic tokens first.');
    render(<DecisionCard decision={decision()} plan={<PlanPreview decision={decision()} />} onAnswer={() => undefined} />);
    const toggle = screen.getByRole('button', { name: /Read the plan/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Semantic tokens first.')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText('Semantic tokens first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByText('r2')).toBeInTheDocument();
  });

  it('says so when the proposal is missing or empty', () => {
    planDoc.current = doc('   ');
    const { unmount } = render(<PlanPreview decision={decision()} />);
    expect(screen.getByText('No plan document on this ticket — the proposal is missing or empty.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read the plan/ })).not.toBeInTheDocument();
    unmount();

    planDoc.current = { data: undefined, isLoading: false, isError: true };
    render(<PlanPreview decision={decision()} />);
    expect(screen.getByText('No plan document on this ticket — the proposal is missing or empty.')).toBeInTheDocument();
  });

  it('renders nothing for a decision that is not a plan approval', () => {
    planDoc.current = doc('# Plan');
    const { container } = render(<PlanPreview decision={decision({ kind: 'merge_approval' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MergeQueueStrip', () => {
  it('says how much is landing and how much is waiting', () => {
    render(<MergeQueueStrip landing={1} waiting={2} onOpen={vi.fn()} />);
    expect(screen.getByText('Merge queue')).toBeInTheDocument();
    expect(screen.getByText('1 landing \u00b7 2 waiting')).toBeInTheDocument();
  });

  it('says nothing is landing when the queue is empty, rather than disappearing', () => {
    render(<MergeQueueStrip landing={0} waiting={0} onOpen={vi.fn()} />);
    expect(screen.getByText('Merge queue')).toBeInTheDocument();
    expect(screen.getByText('nothing landing')).toBeInTheDocument();
  });

  it('opens the merge queue view', () => {
    const onOpen = vi.fn();
    render(<MergeQueueStrip landing={0} waiting={1} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('MergeQueueBadge', () => {
  it('names the position of a waiting ticket', () => {
    render(<MergeQueueBadge position={3} merging={false} />);
    expect(screen.getByText('#3 in the merge queue')).toBeInTheDocument();
  });

  it('says the ticket is the one merging', () => {
    render(<MergeQueueBadge position={null} merging />);
    expect(screen.getByText('merging now')).toBeInTheDocument();
  });

  it('renders nothing for a ticket that is neither', () => {
    const { container } = render(<MergeQueueBadge position={null} merging={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not a control until it is given somewhere to go', () => {
    render(<MergeQueueBadge position={3} merging={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the merge queue view when it has one', () => {
    const onOpen = vi.fn();
    render(<MergeQueueBadge position={3} merging={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the merge queue' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
