import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UI_STATUSES, NAMED_CARD_OPTION_KEYS } from '@agent-conductor/shared';
import type { Decision } from '@agent-conductor/shared';
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
// DecisionCard's "Ask the worker" (VS-106) and "Show PR" (VS-107) links are the only things in this
// file that reach a route; a plain anchor stands in so these tests keep running with no
// RouterProvider, still carrying `to`/`params`/`search` as data attributes for tests that check them.
vi.mock('../app/link', () => ({
  A: ({ children, to, params, search, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} data-to={String(to)} data-params={JSON.stringify(params ?? {})} data-search={JSON.stringify(search ?? {})} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
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

  it('marks an interactive session, and nothing when it is not one (VS-101)', () => {
    const { unmount } = render(<WorkerCard agent={agent()} interactive />);
    expect(screen.getByText('interactive')).toBeInTheDocument();
    unmount();

    render(<WorkerCard agent={agent()} />);
    expect(screen.queryByText('interactive')).not.toBeInTheDocument();
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

  it('links a merge-approval card to a conversation with the worker that asked it (VS-106)', () => {
    render(<DecisionCard decision={decision({ kind: 'merge_approval', ticketId: 'tk_9' })} ws="ws1" onAnswer={() => undefined} />);
    expect(screen.getByRole('link', { name: 'Ask the worker' })).toBeInTheDocument();
  });

  it('offers no such link without a workspace or a ticket to point at', () => {
    const { unmount } = render(<DecisionCard decision={decision({ kind: 'merge_approval', ticketId: 'tk_9' })} onAnswer={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Ask the worker' })).not.toBeInTheDocument();
    unmount();
    render(<DecisionCard decision={decision({ kind: 'merge_approval', ticketId: null })} ws="ws1" onAnswer={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Ask the worker' })).not.toBeInTheDocument();
  });

  it('offers no such link on a decision kind other than merge_approval', () => {
    render(<DecisionCard decision={decision({ kind: 'plan_approval', ticketId: 'tk_9' })} ws="ws1" onAnswer={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Ask the worker' })).not.toBeInTheDocument();
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

  // ---------- VS-111: no card can offer an option its decision does not have ----------
  //
  // Each named-variant card's buttons are hand-written literals, independent of `decision.options`
  // at render time (see DecisionCard's design notes). This is the general rule the ticket asked
  // for: every hard-coded action, for every kind, must send a key that kind's shared canonical
  // option-key map lists — the same map `packages/core` uses when it actually creates the decision.
  // This is exactly what would have caught the Hold and Discard bugs before they shipped.
  describe('a hard-coded card action always sends a key its decision kind actually offers', () => {
    const validKeys = (kind: keyof typeof NAMED_CARD_OPTION_KEYS): string[] => Object.values(NAMED_CARD_OPTION_KEYS[kind]);

    it('plan_approval: Approve and Reject', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'plan_approval' })} onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      expect(onAnswer).toHaveBeenCalledTimes(2);
      for (const call of onAnswer.mock.calls) expect(validKeys('plan_approval')).toContain(call[0]?.key);
    });

    it('plan_approval: Revise', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'plan_approval' })} ticketIdentifier="ACME-42" onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /Revise/ }));
      fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'use a different token layer' } });
      fireEvent.keyDown(screen.getByLabelText('What should change?'), { key: 'Enter' });
      expect(onAnswer).toHaveBeenCalledTimes(1);
      expect(validKeys('plan_approval')).toContain(onAnswer.mock.calls[0]?.[0]?.key);
    });

    it('merge_approval: Approve merge, and offers no Hold', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'merge_approval' })} onAnswer={onAnswer} />);
      expect(screen.queryByRole('button', { name: 'Hold' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Approve merge' }));
      expect(onAnswer).toHaveBeenCalledTimes(1);
      expect(validKeys('merge_approval')).toContain(onAnswer.mock.calls[0]?.[0]?.key);
    });

    it('hire_approval: Hire and Reject', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'hire_approval' })} onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hire' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      expect(onAnswer).toHaveBeenCalledTimes(2);
      for (const call of onAnswer.mock.calls) expect(validKeys('hire_approval')).toContain(call[0]?.key);
    });

    it('discard_approval: Discard', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'discard_approval' })} ticketIdentifier="ACME-42" onAnswer={onAnswer} />);
      fireEvent.change(screen.getByLabelText('Type the ticket identifier to confirm'), { target: { value: 'ACME-42' } });
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(onAnswer).toHaveBeenCalledTimes(1);
      expect(validKeys('discard_approval')).toContain(onAnswer.mock.calls[0]?.[0]?.key);
    });
  });

  // ---------- VS-92: the project label ----------

  it('names its project, and says Workspace when it belongs to none', () => {
    const { unmount } = render(<DecisionCard decision={decision()} ticketIdentifier="ACME-42" projectSlug="web" onAnswer={() => undefined} />);
    expect(screen.getByText('ACME-42 · web')).toBeInTheDocument();
    unmount();
    // An unlabelled card and a card whose project could not be resolved must not look alike.
    render(<DecisionCard decision={decision()} onAnswer={() => undefined} />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('shows the PR link and the project label together on a merge approval', () => {
    render(
      <DecisionCard
        decision={decision({ kind: 'merge_approval', target: { prUrl: 'https://github.test/a/b/pull/7', prNumber: 7 } })}
        ticketIdentifier="ACME-42"
        projectSlug="api"
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByRole('link', { name: /PR #7/ })).toBeInTheDocument();
    expect(screen.getByText('ACME-42 · api')).toBeInTheDocument();
  });

  it('offers "Show PR" on a merge approval with a pull request, opening the explorer in place', () => {
    render(
      <DecisionCard
        decision={decision({ kind: 'merge_approval', target: { prUrl: 'https://github.test/a/b/pull/7', prNumber: 7 } })}
        projectSlug="api"
        ws="ws1"
        onAnswer={() => undefined}
      />,
    );
    const link = screen.getByRole('link', { name: 'Show PR' });
    expect(link.getAttribute('data-to')).toBe('/w/$ws/p/$project');
    expect(JSON.parse(link.getAttribute('data-params') ?? '{}')).toEqual({ ws: 'ws1', project: 'api' });
    expect(JSON.parse(link.getAttribute('data-search') ?? '{}')).toEqual({ pr: 7 });
  });

  it('offers no "Show PR" without a pull request, a project or a workspace to route it to', () => {
    render(<DecisionCard decision={decision({ kind: 'merge_approval', target: {} })} projectSlug="api" ws="ws1" onAnswer={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Show PR' })).not.toBeInTheDocument();

    const { unmount } = render(
      <DecisionCard decision={decision({ kind: 'merge_approval', target: { prNumber: 7 } })} ws="ws1" onAnswer={() => undefined} />,
    );
    expect(screen.queryByRole('link', { name: 'Show PR' })).not.toBeInTheDocument();
    unmount();

    render(<DecisionCard decision={decision({ kind: 'merge_approval', target: { prNumber: 7 } })} projectSlug="api" onAnswer={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Show PR' })).not.toBeInTheDocument();
  });

  it('offers no "Show PR" on a card that is not a merge approval', () => {
    render(<DecisionCard decision={decision({ target: { prNumber: 7 } })} projectSlug="api" ws="ws1" onAnswer={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Show PR' })).not.toBeInTheDocument();
  });

  // ---------- VS-92: answer inputs ----------

  const withInputs = (over: Partial<Decision> = {}): Decision =>
    decision({
      kind: 'question',
      options: [],
      target: null,
      inputs: [
        { key: 'base_url', label: 'Base URL', type: 'text', required: true },
        { key: 'notes', label: 'Anything else', type: 'multiline' },
        { key: 'regions', label: 'Regions', type: 'multiselect', choices: [{ key: 'eu', label: 'EU' }, { key: 'us', label: 'US' }, { key: 'ap', label: 'APAC' }] },
      ],
      ...over,
    });

  it('renders one control per input, in the order the asker gave them', () => {
    render(<DecisionCard decision={withInputs()} onAnswer={() => undefined} />);
    expect(screen.getByLabelText(/Base URL/).tagName).toBe('INPUT');
    expect(screen.getByLabelText(/Anything else/).tagName).toBe('TEXTAREA');
    expect(screen.getAllByRole('checkbox').map((c) => c.textContent)).toEqual(['EU', 'US', 'APAC']);
  });

  it('blocks the send until every required input is filled, and says which one is missing', () => {
    render(<DecisionCard decision={withInputs()} onAnswer={() => undefined} />);
    const send = screen.getByRole('button', { name: /send answer/i });
    expect(send).toBeDisabled();
    expect(screen.getByText('Base URL is needed before this can be sent.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: 'https://example.test' } });
    expect(send).toBeEnabled();
    expect(screen.queryByText('Base URL is needed before this can be sent.')).not.toBeInTheDocument();
  });

  it('selects and deselects multi-select choices and sends the chosen keys', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={withInputs()} onAnswer={onAnswer} />);
    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: 'https://example.test' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'EU' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'US' }));
    expect(screen.getByRole('checkbox', { name: 'US' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'US' }));
    expect(screen.getByRole('checkbox', { name: 'US' })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    // The empty optional note is absent, not present and empty.
    expect(onAnswer).toHaveBeenCalledWith({ inputs: { base_url: 'https://example.test', regions: ['eu'] } });
  });

  it('sends the values alongside a chosen option', () => {
    const onAnswer = vi.fn();
    render(
      <DecisionCard
        decision={withInputs({ options: [{ key: 'now', label: 'Now' }, { key: 'later', label: 'Later' }] })}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: 'https://example.test' } });
    fireEvent.click(screen.getByRole('radio', { name: /Now/ }));
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    expect(onAnswer).toHaveBeenCalledWith({ key: 'now', inputs: { base_url: 'https://example.test' } });
  });

  it('masks a secret input and never renders the value back', () => {
    const onAnswer = vi.fn();
    render(
      <DecisionCard
        decision={decision({ kind: 'question', options: [], target: null, inputs: [{ key: 'token', label: 'Read-only token', type: 'secret', required: true, secretName: 'CF_READONLY_TOKEN' }] })}
        onAnswer={onAnswer}
      />,
    );
    const field = screen.getByLabelText(/Read-only token/) as HTMLInputElement;
    expect(field.type).toBe('password');
    // The card says where the value is going, by name.
    expect(screen.getByText('CF_READONLY_TOKEN')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'cf-not-a-real-token-0000000000' } });
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    expect(onAnswer).toHaveBeenCalledWith({ inputs: { token: 'cf-not-a-real-token-0000000000' } });
  });

  it('shows an answered card\'s values as a record, a secret as the name it was stored under', () => {
    render(
      <DecisionCard
        decision={withInputs({
          status: 'answered', answerKey: null, answeredAt: '2026-09-07T12:00:00.000Z',
          inputs: [
            { key: 'regions', label: 'Regions', type: 'multiselect', choices: [{ key: 'eu', label: 'EU' }, { key: 'us', label: 'US' }] },
            { key: 'token', label: 'Read-only token', type: 'secret', secretName: 'CF_READONLY_TOKEN' },
          ],
          answerInputs: { regions: ['eu', 'us'], token: 'CF_READONLY_TOKEN' },
        })}
        onAnswer={() => undefined}
      />,
    );
    // Choice labels, not keys, and no controls to answer with again.
    expect(screen.getByText('EU, US')).toBeInTheDocument();
    expect(screen.getByText('stored as CF_READONLY_TOKEN')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send answer/i })).not.toBeInTheDocument();
  });

  it('leaves a card with no inputs exactly as it was', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={question()} onAnswer={onAnswer} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /localStorage/ }));
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    // No `inputs` key at all, so nothing downstream has to distinguish empty from absent.
    expect(onAnswer).toHaveBeenCalledWith({ key: 'local' });
  });
});

describe('Composer', () => {
  it('submits on Enter and clears', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'add dark mode' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('add dark mode');
    expect(box.value).toBe('');
  });

  it('leaves the line break to Shift+Enter at a desk', () => {
    hoverNone(false);
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'first line' } });

    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box.value).toBe('first line');
    expect(box).not.toHaveAttribute('enterkeyhint');
  });

  // On a phone there is no modifier to hold, so Enter has to be the newline and the button the send.
  // The handler must not touch the event at all: the browser inserts the break itself (VS-89).
  it('leaves Enter to the browser on touch, and still sends from the button', () => {
    hoverNone(true);
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'first line' } });

    // `fireEvent` returns false only when a listener called preventDefault.
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSubmit).toHaveBeenCalledWith('first line');
  });

  it('asks the on-screen keyboard for a newline key on touch', () => {
    hoverNone(true);
    render(<Composer onSubmit={() => undefined} placeholder="Message the conductor…" />);
    expect(screen.getByLabelText('Message the conductor…')).toHaveAttribute('enterkeyhint', 'enter');
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

  // ---------- VS-133: attachments ----------

  it('offers no browse control and ignores a pasted image when attachments are not allowed', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message the conductor…" />);
    expect(screen.queryByLabelText('Attach a file')).not.toBeInTheDocument();
    const box = screen.getByLabelText('Message the conductor…');
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(box, { clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] } });
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();
  });

  it('adds a browsed file as a pending attachment, shown as a chip', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('adds a pasted image to the same pending state browse produces', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…');
    const file = new File(['x'], 'clipboard.png', { type: 'image/png' });
    fireEvent.paste(box, { clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] } });
    expect(screen.getByText('clipboard.png')).toBeInTheDocument();
  });

  it('rejects a disallowed file type client-side, without adding it', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument();
    expect(screen.getByText(/Only images .* and plain text\/markdown/)).toBeInTheDocument();
  });

  it('a removed chip drops the file from what will be sent', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByLabelText('Remove shot.png'));
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();

    const box = screen.getByLabelText('Message the conductor…');
    fireEvent.change(box, { target: { value: 'no attachment now' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSubmit).toHaveBeenCalledWith('no attachment now');
  });

  it('sends the pending files with the text, and clears both once the send resolves', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Composer onSubmit={onSubmit} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'look at this' } });
    fireEvent.click(screen.getByLabelText('Send'));

    expect(onSubmit).toHaveBeenCalledWith('look at this', [file]);
    await waitFor(() => expect(screen.queryByText('shot.png')).not.toBeInTheDocument());
    expect(box.value).toBe('');
  });

  it('a rejected send leaves the text and the attachment exactly as they were', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('too large'));
    render(<Composer onSubmit={onSubmit} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'look at this' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Give the rejected promise's .catch a turn, then assert nothing was cleared.
    await new Promise((r) => setTimeout(r, 0));
    expect(box.value).toBe('look at this');
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('caps pending attachments at four and says so', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const files = Array.from({ length: 5 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }));
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files } });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/At most 4 files per message/)).toBeInTheDocument();
  });

  // The composer reads `(hover: none)` at render to tell a phone from a desk. jsdom answers every
  // query `false` from the shared setup stub, which is the desk; a touch case has to say so.
  function hoverNone(touch: boolean): void {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('hover: none') ? touch : false,
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    onTestFinished(() => {
      window.matchMedia = real;
    });
  }

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
