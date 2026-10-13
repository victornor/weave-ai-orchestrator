import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UI_STATUSES, NAMED_CARD_OPTION_KEYS } from '@weave-ai/shared';
import type { Decision, TicketAttachment, WorkerModelOption } from '@weave-ai/shared';
import { StatusGlyph, StatusBadge } from '../components/StatusGlyph';
import { TicketCard } from '../components/TicketCard';
import { DecisionCard } from '../components/DecisionCard';
import { DocumentPreview } from '../components/DocumentPreview';
import { Composer } from '../components/Composer';
import { BudgetMeter } from '../components/BudgetMeter';
import { TOTPInput } from '../components/TOTPInput';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { EmptyState, ErrorState } from '../components/States';
import { ApiError } from '../api/client';
import { PlanPreview } from '../components/PlanPreview';
import { decision, ticket } from './factories';

/**
 * VS-281: a card the weaver has reviewed. Since an unreviewed card withholds its approve action,
 * every test whose subject is not the review state uses this so its Approve/Approve merge is offered.
 */
const reviewed = (over: Partial<Decision> = {}): Decision =>
  decision({ weaverReviewStatus: 'looked', weaverReviewedAt: '2026-09-11T03:01:00.000Z', weaverReviewNote: 'reviewed', ...over });

/** VS-555: one ticket attachment for the evidence-strip tests. */
const attachment = (over: Partial<TicketAttachment> = {}): TicketAttachment => ({
  id: 'att1',
  ticketId: 'tk_9',
  label: 'capture.png',
  mediaType: 'image/png',
  byteSize: 1234,
  sha256: 'sha',
  storageKey: 'att1.png',
  createdAt: '2026-09-18T01:00:00.000Z',
  url: '/api/w/ws1/tickets/tk_9/attachments/att1',
  ...over,
});

const planDoc = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const docById = vi.hoisted(() => ({
  head: null as Record<string, unknown> | null,
  named: null as Record<string, unknown> | null,
  calls: [] as Array<[string | undefined, string | undefined, number | undefined]>,
}));
const handoverState = vi.hoisted(() => ({
  current: null as { resumable: boolean; command: string | null; runtime: string; landingLine: string | null; reason: string | null } | null,
  startMutate: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  calls: [] as Array<{ ws: string; id: string; enabled: boolean }>,
}));
/** VS-555: the ticket detail the approval card's evidence strip reads. */
const evidenceState = vi.hoisted(() => ({ current: null as { attachments?: TicketAttachment[] } | null }));
vi.mock('../api/hooks', () => ({
  useTicketDocument: () => planDoc.current ?? { data: undefined, isLoading: false, isError: true },
  // VS-224: the document-target fetch. `head` answers the HEAD call, `named` the revision-named
  // one; `calls` records every call so a test can prove the hook never ran.
  useTicketDocumentById: (id?: string, documentId?: string, revision?: number) => {
    docById.calls.push([id, documentId, revision]);
    const source = revision === undefined ? docById.head : docById.named;
    return source ?? { data: undefined, isLoading: false, isError: true };
  },
  useHandoverCommandFor: (ws: string, id: string, enabled: boolean) => {
    handoverState.calls.push({ ws, id, enabled });
    return { data: enabled ? (handoverState.current ?? undefined) : undefined, isLoading: false, isError: false };
  },
  useStartHandoverFor: () => ({ mutate: handoverState.startMutate }),
  // VS-555: the approval card's evidence strip reads the ticket detail; these tests carry none.
  useTicketFor: () => ({ data: evidenceState.current ?? undefined }),
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(() => 'id'), dismiss: vi.fn() }) }));
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

  it('labels a finished operational ticket as ran', () => {
    render(<TicketCard ticket={ticket({ kind: 'operational', status: 'done', title: 'Restart the daemon' })} />);
    expect(screen.getByText('ran')).toBeInTheDocument();
  });
});

describe('TicketCard — incomplete delivery (VS-250)', () => {
  it('marks a done ticket whose merged PR has no merge-done record, not an ordinary merge', () => {
    render(<TicketCard ticket={ticket({ status: 'done', delivery: { prUrl: 'https://example.com/pull/190', prState: 'merged' } })} />);
    expect(screen.getByText('delivery incomplete')).toBeInTheDocument();
    expect(screen.queryByText('PR merged')).not.toBeInTheDocument();
    expect(screen.queryByText('merged')).not.toBeInTheDocument();
  });

  it("still reads merge-done's complete record as merged", () => {
    render(<TicketCard ticket={ticket({ status: 'done', delivery: { merged: true, mergeCommit: 'a'.repeat(40), method: 'squash' } })} />);
    expect(screen.getByText('merged')).toBeInTheDocument();
    expect(screen.queryByText('delivery incomplete')).not.toBeInTheDocument();
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

  // VS-201: the card's own preview stays a capped one-liner, but the tooltip behind it carries
  // whatever fuller text the caller has for it, not merely the same capped string again.
  it('carries the complete message in the tooltip behind the capped preview', () => {
    render(
      <TicketCard
        ticket={ticket()}
        workerPausedFor="unknown · Cannot use this model: grok-4-6. Available models: auto,…"
        workerPausedForFull="unknown · Cannot use this model: grok-4-6. Available models: auto, gpt-5.9-sol-xhigh"
      />,
    );
    const preview = screen.getByText(/paused ·/);
    expect(preview.textContent).toContain('auto,…');
    expect(preview.getAttribute('title')).toContain('gpt-5.9-sol-xhigh');
  });

  it('falls back to the preview text as the tooltip when no fuller text is given', () => {
    render(<TicketCard ticket={ticket()} workerPausedFor="unknown · the CLI died" />);
    expect(screen.getByText(/paused ·/).getAttribute('title')).toBe('unknown · the CLI died');
  });
});

describe('TicketCard — worker model tier tag (VS-217)', () => {
  const opt = (id: string): WorkerModelOption => ({ id, description: `${id} tier`, runtime: 'claude', model: null });

  it('shows the ticket\'s option id when several options are configured', () => {
    render(<TicketCard ticket={ticket({ workerModelId: 'deep' })} workerOptions={[opt('quick'), opt('standard'), opt('deep')]} />);
    expect(screen.getByText('deep')).toBeInTheDocument();
    // Nothing else on the card moved: kind, title and age are all still there.
    expect(screen.getByText('change')).toBeInTheDocument();
    expect(screen.getByText('Dark mode for the dashboard')).toBeInTheDocument();
  });

  it('labels a ticket on the workers default', () => {
    render(<TicketCard ticket={ticket()} workerOptions={[opt('quick'), opt('standard')]} />);
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('shows no tag with one configured option', () => {
    render(<TicketCard ticket={ticket({ workerModelId: 'quick' })} workerOptions={[opt('quick')]} />);
    expect(screen.queryByText('quick')).not.toBeInTheDocument();
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
    // VS-281: an approve action is only offered on a card the weaver has reviewed.
    render(<DecisionCard decision={reviewed()} ticketIdentifier="ACME-42" onAnswer={() => undefined} />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revise/ })).toBeInTheDocument();
    expect(screen.getByText('ThemeProvider + OS fallback')).toBeInTheDocument();
  });

  // VS-201: a worker-failure card used to arrive already truncated (before this test's fix) with no
  // control and no sign that anything had been cut. This asserts the complete text is reachable, not
  // merely that a button exists.
  it('collapses a long context behind a control, and expanding it reveals the complete text', () => {
    const models = Array.from({ length: 60 }, (_, i) => `gpt-5.${i}-sol-high`).join(', ');
    const longContext = `Last error: Cannot use this model: grok-4-6. Available models: auto, ${models}`;
    render(<DecisionCard decision={decision({ kind: 'retry_approval', context: longContext })} onAnswer={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Show full text' })).toBeInTheDocument();
    expect(screen.queryByText(/gpt-5\.59-sol-high/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show full text' }));
    expect(screen.getByText(/gpt-5\.59-sol-high/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('renders a short context inline with no control', () => {
    render(<DecisionCard decision={decision({ kind: 'retry_approval', context: 'Last error: the CLI died.' })} onAnswer={() => undefined} />);
    expect(screen.getByText('Last error: the CLI died.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show full text' })).not.toBeInTheDocument();
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

  // VS-555: the same card the ticket page mounts shows the ticket's evidence.
  it('shows the ticket evidence on an approval card, and nothing when the ticket has none', () => {
    evidenceState.current = { attachments: [
      attachment({ id: 'shot', label: 'dashboard.png' }),
      attachment({ id: 'zip', label: 'logs.zip', mediaType: 'application/zip' }),
    ] };
    onTestFinished(() => { evidenceState.current = null; });
    const { unmount } = render(<DecisionCard decision={decision({ kind: 'merge_approval', ticketId: 'tk_9' })} ws="ws1" onAnswer={() => undefined} />);
    expect(screen.getByAltText('dashboard.png')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /logs\.zip/ })).toBeInTheDocument();
    unmount();
    evidenceState.current = { attachments: [] };
    render(<DecisionCard decision={decision({ kind: 'merge_approval', ticketId: 'tk_9' })} ws="ws1" onAnswer={() => undefined} />);
    expect(document.querySelector('[data-v2-section="evidence"]')).toBeNull();
  });

  it('answers with the approve key', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={reviewed()} onAnswer={onAnswer} />);
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

  it('names the weaver as the asker of a weaver question', () => {
    render(<DecisionCard decision={question()} asker="weaver" onAnswer={() => undefined} />);
    expect(screen.getByText('Weaver asks')).toBeInTheDocument();
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
        asker="weaver"
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

  // ---------- VS-342: several closed-set questions on one card ----------

  const choiceCard = (over: Partial<Parameters<typeof decision>[0]> = {}): ReturnType<typeof decision> =>
    decision({
      kind: 'question',
      allowFreeText: false,
      options: [],
      inputs: [
        {
          key: 'served', label: 'How is V2 served', type: 'single_choice', required: true, description: 'Where the new UI is hosted.',
          choices: [{ key: 'same', label: 'Same app', recommended: true }, { key: 'sep', label: 'Separate build' }],
        },
        {
          key: 'drop', label: 'Drop V1 screens', type: 'single_choice', required: true,
          choices: [{ key: 'none', label: 'None', recommended: true }, { key: 'settings', label: 'Settings' }],
        },
      ],
      ...over,
    });

  it('renders several single-choice questions, pre-selects the recommended choices, and sends them in one answer', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={choiceCard()} onAnswer={onAnswer} />);
    expect(screen.getByText(/How is V2 served/)).toBeInTheDocument();
    expect(screen.getByText('Drop V1 screens')).toBeInTheDocument();
    expect(screen.getByText('Where the new UI is hosted.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Same app/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /None/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ inputs: { served: 'same', drop: 'none' } });
  });

  it('marks the recommendation RECOMMENDED whatever is selected, with selection shown only by the checked state', () => {
    render(<DecisionCard decision={decision({
      kind: 'question', allowFreeText: false, options: [],
      inputs: [{
        key: 'served', label: 'How is V2 served', type: 'single_choice',
        choices: [{ key: 'same', label: 'Same app', recommended: true }, { key: 'sep', label: 'Separate build' }],
      }],
    })} onAnswer={() => undefined} />);
    const recommended = screen.getByRole('radio', { name: /Same app/ });
    const other = screen.getByRole('radio', { name: /Separate build/ });
    expect(recommended).toBeChecked();
    expect(screen.getAllByText('RECOMMENDED')).toHaveLength(1);

    fireEvent.click(other);
    expect(other).toBeChecked();
    expect(recommended).not.toBeChecked();
    // The recommended choice keeps its tag even when it is not the one selected.
    expect(screen.getByText('RECOMMENDED')).toBeInTheDocument();
    expect(screen.queryByText('PICKED')).not.toBeInTheDocument();
  });

  it('takes the human\'s own words for a single-choice question that allows them', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={decision({
      kind: 'question', allowFreeText: false, options: [],
      inputs: [{
        key: 'served', label: 'How is V2 served', type: 'single_choice', allowOther: true,
        choices: [{ key: 'same', label: 'Same app', recommended: true }, { key: 'sep', label: 'Separate build' }],
      }],
    })} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Write your own…' }));
    fireEvent.change(screen.getByLabelText('How is V2 served — your own answer'), { target: { value: 'a standalone gateway' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ inputs: { served: 'a standalone gateway' } });
  });

  it('shows each question and the answer it was given on an answered card', () => {
    render(<DecisionCard
      decision={choiceCard({ status: 'answered', answeredAt: '2026-09-13T19:00:00.000Z', answerInputs: { served: 'sep', drop: 'none' } })}
      onAnswer={() => undefined}
    />);
    expect(screen.getByText(/Separate build/)).toBeInTheDocument();
    expect(screen.getByText(/None/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('pre-fills an input carrying a default', () => {
    render(<DecisionCard decision={decision({
      kind: 'question', allowFreeText: false, options: [],
      inputs: [{ key: 'url', label: 'Base URL', type: 'text', default: 'https://example.test' }],
    })} onAnswer={() => undefined} />);
    expect(screen.getByDisplayValue('https://example.test')).toBeInTheDocument();
  });

  it('says a relayed answer is the human\'s words recorded by the weaver (VS-310)', () => {
    render(
      <DecisionCard
        decision={question({ status: 'answered', answerKey: null, answerText: 'go with sqlite', relayedFromMessageId: 'msg_1' })}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText('go with sqlite')).toBeInTheDocument();
    expect(screen.getByText("The human's words, recorded by the weaver from their message.")).toBeInTheDocument();
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
      render(<DecisionCard decision={reviewed({ kind: 'plan_approval' })} onAnswer={onAnswer} />);
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

    it('action_approval: Approve and Reject', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={reviewed({ kind: 'action_approval' })} onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      expect(onAnswer).toHaveBeenCalledTimes(2);
      for (const call of onAnswer.mock.calls) expect(validKeys('action_approval')).toContain(call[0]?.key);
    });

    it('action_approval: Revise', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'action_approval' })} ticketIdentifier="ACME-42" onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /Revise/ }));
      fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'name the host' } });
      fireEvent.keyDown(screen.getByLabelText('What should change?'), { key: 'Enter' });
      expect(onAnswer).toHaveBeenCalledTimes(1);
      expect(validKeys('action_approval')).toContain(onAnswer.mock.calls[0]?.[0]?.key);
    });

    it('merge_approval: Approve merge, and offers no Hold', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={reviewed({ kind: 'merge_approval' })} onAnswer={onAnswer} />);
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

    // VS-335: a permission change on an existing role reuses the hire_approval kind but must not read
    // as hiring the role again.
    it('hire_approval for a role permission change: Approve, not Hire', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'hire_approval', target: { roleId: 'role1', permissionChange: true } })} onAnswer={onAnswer} />);
      expect(screen.queryByRole('button', { name: 'Hire' })).not.toBeInTheDocument();
      expect(screen.getByText('Role approval')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      expect(onAnswer).toHaveBeenCalledTimes(1);
      expect(onAnswer.mock.calls[0]?.[0]?.key).toBe(NAMED_CARD_OPTION_KEYS.hire_approval.approve);
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

  describe('conductor review line (VS-223, VS-234)', () => {
    it('shows unseen on a plan card, withholds Approve, and keeps Reject (VS-281)', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={decision({ kind: 'plan_approval' })} onAnswer={onAnswer} />);
      const line = screen.getByText("Weaver hasn't reviewed yet");
      expect(line).toHaveClass('text-blocked');
      expect(screen.getByText('Approval waits on the weaver\u2019s review — you can override it.')).toBeInTheDocument();
      // VS-281: the approving action is not offered at all — only the deliberate override is.
      expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Override & approve/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      expect(onAnswer.mock.calls.map((c) => c[0]?.key)).toEqual(['reject']);
    });

    it('shows a reviewed merge card as its conclusion with its note, still Approve merge', () => {
      const onAnswer = vi.fn();
      const { unmount } = render(
        <DecisionCard
          decision={decision({
            kind: 'merge_approval',
            weaverReviewStatus: 'looked',
            weaverReviewedAt: '2026-09-11T03:01:00.000Z',
            weaverReviewNote: 'squash diff matches the approved plan',
          })}
          onAnswer={onAnswer}
        />,
      );
      const looked = screen.getByText('Weaver reviewed — no concerns');
      expect(looked).toHaveClass('text-text-3');
      expect(looked).not.toHaveClass('text-blocked');
      expect(screen.getByText('squash diff matches the approved plan')).toBeInTheDocument();
      expect(screen.queryByText("Weaver hasn't reviewed yet")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Approve merge' }));
      expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ key: 'approve' }));
      unmount();

      render(<DecisionCard decision={decision({ kind: 'merge_approval' })} onAnswer={() => undefined} />);
      expect(screen.getByText("Weaver hasn't reviewed yet")).toBeInTheDocument();
      expect(screen.queryByText('Weaver reviewed — no concerns')).not.toBeInTheDocument();
    });

    it('renders a legacy clean mark (no note) as the line alone (VS-234)', () => {
      render(
        <DecisionCard
          decision={decision({
            kind: 'merge_approval',
            weaverReviewStatus: 'looked',
            weaverReviewedAt: '2026-09-11T03:01:00.000Z',
            weaverReviewNote: null,
          })}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.getByText('Weaver reviewed — no concerns')).toBeInTheDocument();
      const review = screen.getByText('Weaver reviewed — no concerns').parentElement!;
      expect(review.querySelectorAll('p')).toHaveLength(1);
    });

    it('renders the review waiting statement as its own line (VS-481)', () => {
      render(
        <DecisionCard
          decision={decision({
            kind: 'merge_approval',
            weaverReviewStatus: 'looked',
            weaverReviewedAt: '2026-09-11T03:01:00.000Z',
            weaverReviewNote: 'nothing to object to',
            weaverReviewWaitingOn: 'waiting for runner CI on 414b329d',
          })}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.getByText('Weaver: waiting for runner CI on 414b329d')).toBeInTheDocument();
    });

    it('shows the CI chip from the ticket delivery on a merge card (VS-481)', () => {
      render(
        <DecisionCard
          decision={decision({ kind: 'merge_approval' })}
          delivery={{ prState: 'open', ciState: 'pending', prChecks: { passed: 2, total: 4 }, ciChecks: [{ name: 'lint', state: 'pending' }] }}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.getByText('Waiting for CI · 2/4')).toBeInTheDocument();
      expect(screen.getByText('lint')).toBeInTheDocument();
    });

    it('shows no CI chip on a plan card even with a delivery (VS-481)', () => {
      render(
        <DecisionCard
          decision={decision({ kind: 'plan_approval' })}
          delivery={{ prState: 'open', ciState: 'success', prChecks: { passed: 2, total: 2 } }}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.queryByText('CI passed')).toBeNull();
    });

    it('compares CI against prHead, not the reviewed head (VS-481 review)', () => {
      render(
        <DecisionCard
          decision={decision({ kind: 'merge_approval', weaverReviewStatus: 'looked', weaverReviewedAt: '2026-09-11T03:01:00.000Z', weaverReviewNote: 'read it', weaverReviewedHeadSha: 'reviewed-head' })}
          delivery={{ prState: 'open', ciState: 'success', prChecks: { passed: 2, total: 2 }, ciHead: 'current-head', prHead: 'current-head' }}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.getByText('CI passed')).toBeInTheDocument();
      expect(screen.queryByText('CI on an older commit')).toBeNull();
    });

    it('approving a reviewed card is immediate and sends the same key as an unseen one (VS-234)', () => {
      const onAnswer = vi.fn();
      render(
        <DecisionCard
          decision={decision({
            kind: 'plan_approval',
            weaverReviewStatus: 'looked',
            weaverReviewedAt: '2026-09-11T03:01:00.000Z',
            weaverReviewNote: 'plan covers the scope',
          })}
          onAnswer={onAnswer}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
      expect(onAnswer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'approve' }));
    });

    it('shows the concern note as a text block, not a Badge', () => {
      // VS-266: an open concern now holds approval — see the "held approval" describe block below
      // for the disabled Approve and the override path. This test stays about the note's rendering.
      const { container } = render(
        <DecisionCard
          decision={decision({
            kind: 'plan_approval',
            weaverReviewStatus: 'concerns',
            weaverReviewedAt: '2026-09-11T03:01:00.000Z',
            weaverReviewNote: 'the migration contradicts itself',
          })}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.getByText('Weaver reviewed — has concerns')).toBeInTheDocument();
      const note = screen.getByText('the migration contradicts itself');
      expect(note.tagName).toBe('P');
      const review = container.querySelector('[data-weaver-review="concerns"]');
      expect(review?.querySelector('[class*="uppercase"]')).toBeNull();
    });

    it('uses after-the-fact copy on an answered card', () => {
      render(
        <DecisionCard
          decision={decision({
            kind: 'plan_approval',
            status: 'answered',
            answerKey: 'approve',
            answeredAt: '2026-09-11T03:01:00.000Z',
            weaverReviewStatus: 'looked',
            weaverReviewedAt: '2026-09-11T03:02:00.000Z',
            weaverReviewNote: 'looked again after the merge',
          })}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.getByText('Weaver reviewed after you answered — no concerns')).toBeInTheDocument();
    });

    it('puts no review line on a question card', () => {
      render(<DecisionCard decision={question()} onAnswer={() => undefined} />);
      expect(screen.queryByText(/Conductor/)).not.toBeInTheDocument();
    });

    it('still shows the line on a compact chat card, not behind an expander', () => {
      render(<DecisionCard decision={decision({ kind: 'plan_approval' })} compact onAnswer={() => undefined} />);
      expect(screen.getByText("Weaver hasn't reviewed yet")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
    });
  });

  describe('held approval (VS-266)', () => {
    const held = (kind: 'plan_approval' | 'action_approval' | 'merge_approval') =>
      decision({
        kind, status: 'open', weaverReviewStatus: 'concerns',
        weaverReviewedAt: '2026-09-11T03:01:00.000Z', weaverReviewNote: 'the migration needs splitting',
      });

    it('disables Approve on a held plan_approval and shows the held sentence', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={held('plan_approval')} onAnswer={onAnswer} />);
      expect(screen.getByText('Approval is held until this is revised, or you override it.')).toBeInTheDocument();
      const approve = screen.getByRole('button', { name: /^Approve/ });
      expect(approve).toBeDisabled();
      fireEvent.click(approve);
      expect(onAnswer).not.toHaveBeenCalled();
    });

    it('disables Approve merge on a held merge_approval', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={held('merge_approval')} onAnswer={onAnswer} />);
      const approve = screen.getByRole('button', { name: 'Approve merge' });
      expect(approve).toBeDisabled();
      fireEvent.click(approve);
      expect(onAnswer).not.toHaveBeenCalled();
    });

    it('does not disable Approve, or show the held sentence, once looked replaces the concern', () => {
      render(
        <DecisionCard
          decision={decision({ kind: 'plan_approval', weaverReviewStatus: 'looked', weaverReviewedAt: '2026-09-11T03:01:00.000Z', weaverReviewNote: 'clean now' })}
          onAnswer={() => undefined}
        />,
      );
      expect(screen.queryByText(/is held/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Approve/ })).not.toBeDisabled();
    });

    it('Revise and Reject stay enabled on a held plan_approval', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={held('plan_approval')} ticketIdentifier="ACME-42" onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /Revise/ }));
      fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'split the migration' } });
      fireEvent.keyDown(screen.getByLabelText('What should change?'), { key: 'Enter' });
      expect(onAnswer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'revise' }));
    });

    it('offers a distinct Override & approve control that requires its own reason', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={held('plan_approval')} ticketIdentifier="ACME-42" onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /Override & approve/ }));
      const field = screen.getByLabelText('Why override the hold?');
      // Submitting empty does nothing — Composer refuses a blank answer.
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(onAnswer).not.toHaveBeenCalled();
      fireEvent.change(field, { target: { value: 'acceptable risk, ship it' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ key: 'approve', overrideHold: true, overrideReason: 'acceptable risk, ship it' });
    });

    it('offers the override control on a held merge_approval too, with the merge approve key', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={held('merge_approval')} onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /Override & approve/ }));
      fireEvent.change(screen.getByLabelText('Why override the hold?'), { target: { value: 'CI is flaky, unrelated' } });
      fireEvent.keyDown(screen.getByLabelText('Why override the hold?'), { key: 'Enter' });
      expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ key: 'approve', overrideHold: true, overrideReason: 'CI is flaky, unrelated' });
    });

    it('offers no override control when the decision is not held', () => {
      render(<DecisionCard decision={reviewed({ kind: 'plan_approval' })} onAnswer={() => undefined} />);
      expect(screen.queryByRole('button', { name: /Override & approve/ })).not.toBeInTheDocument();
    });
  });

  describe('unreviewed approval (VS-281)', () => {
    const unreviewed = (kind: 'plan_approval' | 'action_approval' | 'merge_approval') =>
      decision({ kind, status: 'open', weaverReviewStatus: 'unseen' });

    it('withholds Approve on an unreviewed plan and action approval, keeping Revise and Reject', () => {
      for (const kind of ['plan_approval', 'action_approval'] as const) {
        const { unmount } = render(<DecisionCard decision={unreviewed(kind)} onAnswer={() => undefined} />);
        expect(screen.getByText('Approval waits on the weaver\u2019s review — you can override it.'), kind).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Approve/ }), kind).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Override & approve/ }), kind).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Revise/ }), kind).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' }), kind).toBeInTheDocument();
        unmount();
      }
    });

    it('withholds Approve merge on an unreviewed merge approval, keeping the override', () => {
      render(<DecisionCard decision={unreviewed('merge_approval')} onAnswer={() => undefined} />);
      expect(screen.queryByRole('button', { name: 'Approve merge' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Override & approve/ })).toBeInTheDocument();
    });

    it('lets the human override with a stated reason, sending the approve key and the override pair', () => {
      const onAnswer = vi.fn();
      render(<DecisionCard decision={unreviewed('plan_approval')} ticketIdentifier="ACME-42" onAnswer={onAnswer} />);
      fireEvent.click(screen.getByRole('button', { name: /Override & approve/ }));
      const field = screen.getByLabelText('Why override the hold?');
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(onAnswer).not.toHaveBeenCalled();
      fireEvent.change(field, { target: { value: 'read it myself, ship it' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ key: 'approve', overrideHold: true, overrideReason: 'read it myself, ship it' });
    });

    it('offers the normal Approve again once the card is marked looked', () => {
      render(<DecisionCard decision={reviewed({ kind: 'plan_approval' })} onAnswer={() => undefined} />);
      expect(screen.getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
      expect(screen.queryByText('Approval waits on the weaver\u2019s review — you can override it.')).not.toBeInTheDocument();
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

  // ---------- VS-139: context renders as markdown, with the chat's copy affordance ----------

  it('renders context as markdown instead of literal asterisks and backticks', () => {
    render(<DecisionCard decision={decision({ context: '**bold** and `git status`' })} onAnswer={() => undefined} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*bold\*\*/)).not.toBeInTheDocument();
    expect(screen.getByText('git status')).toHaveClass('ac-copy');
  });

  it('renders a worker-raised question\'s context as markdown exactly as a conductor\'s is', () => {
    render(<DecisionCard decision={question({ context: 'run `pnpm test` first' })} asker="worker" onAnswer={() => undefined} />);
    expect(screen.getByText('pnpm test')).toHaveClass('ac-copy');
  });

  it('cannot turn a worker-authored context into a script or an unsafe link', () => {
    const hostile = 'see <script>alert(1)</script>, [click](javascript:alert(1)), [[looks-like-a-doc]]';
    const { container } = render(<DecisionCard decision={question({ context: hostile })} asker="worker" onAnswer={() => undefined} />);
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('javascript:');
    // The doc-link syntax is still recognised — inert, not a way out — since a card's context can
    // legitimately reference a knowledge doc; what matters is it never becomes an unsafe target.
    const doclink = container.querySelector('a.ac-doclink');
    expect(doclink).toBeInTheDocument();
    expect(doclink).toHaveAttribute('href', '#doc:looks-like-a-doc');
  });

  // ---------- VS-146: provenance tag, plan-approval summary, compact density ----------

  it('shows a Filed by conductor tag only when told the ticket was conductor-filed', () => {
    const { unmount } = render(<DecisionCard decision={decision()} ticketFiledByConductor onAnswer={() => undefined} />);
    expect(screen.getByText('Filed by weaver')).toBeInTheDocument();
    unmount();
    render(<DecisionCard decision={decision()} onAnswer={() => undefined} />);
    expect(screen.queryByText('Filed by weaver')).not.toBeInTheDocument();
  });

  it('shows no provenance tag when the ticket is human-filed or the card has no ticket', () => {
    const { unmount } = render(<DecisionCard decision={decision()} ticketFiledByConductor={false} onAnswer={() => undefined} />);
    expect(screen.queryByText('Filed by weaver')).not.toBeInTheDocument();
    unmount();
    render(<DecisionCard decision={decision({ ticketId: null })} onAnswer={() => undefined} />);
    expect(screen.queryByText('Filed by weaver')).not.toBeInTheDocument();
  });

  it('renders a plan-approval summary as a single plain-text line under the title', () => {
    render(<DecisionCard decision={decision()} ticketSummary="Remind captain why this exists." onAnswer={() => undefined} />);
    expect(screen.getByText('Remind captain why this exists.')).toBeInTheDocument();
    expect(screen.getByText('Remind captain why this exists.').tagName).toBe('P');
  });

  it('shows no summary line when the ticket has none', () => {
    render(<DecisionCard decision={decision({ title: 'Plan: dark mode for the dashboard' })} onAnswer={() => undefined} />);
    expect(screen.queryByText('Remind captain why this exists.')).not.toBeInTheDocument();
    expect(screen.getByText('Plan: dark mode for the dashboard')).toBeInTheDocument();
  });

  it('does not render a summary on a non-plan-approval card even when the prop is set', () => {
    render(
      <DecisionCard
        decision={decision({ kind: 'merge_approval', title: 'Merge ACME-42' })}
        ticketSummary="Remind captain why this exists."
        onAnswer={() => undefined}
      />,
    );
    expect(screen.queryByText('Remind captain why this exists.')).not.toBeInTheDocument();
  });

  it('applies compact density classes only when compact is set', () => {
    const { unmount } = render(<DecisionCard decision={reviewed()} compact onAnswer={() => undefined} />);
    const compactBody = screen.getByRole('article').querySelector(':scope > div:last-of-type');
    expect(compactBody).toHaveClass('p-3');
    expect(compactBody).not.toHaveClass('p-3.5');
    expect(screen.getByRole('button', { name: /Approve/ })).toHaveClass('px-3', 'text-ui', 'h-thumb');
    unmount();
    render(<DecisionCard decision={reviewed()} onAnswer={() => undefined} />);
    const defaultBody = screen.getByRole('article').querySelector(':scope > div:last-of-type');
    expect(defaultBody).toHaveClass('p-3.5');
    expect(screen.getByRole('button', { name: /Approve/ })).toHaveClass('px-4', 'text-body', 'h-thumb');
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
  });

  describe('session handover (VS-249)', () => {
    it('offers no "I need to do this myself" band without both an asker and a workspace', () => {
      const { unmount } = render(<DecisionCard decision={decision()} askedBy="a1" onAnswer={() => undefined} />);
      expect(screen.queryByText(/i need to do this myself/i)).not.toBeInTheDocument();
      unmount();
      render(<DecisionCard decision={decision()} ws="ws1" onAnswer={() => undefined} />);
      expect(screen.queryByText(/i need to do this myself/i)).not.toBeInTheDocument();
    });

    it('does not fetch the command until the band is opened', () => {
      handoverState.calls = [];
      render(<DecisionCard decision={decision()} askedBy="a1" ws="ws1" onAnswer={() => undefined} />);
      expect(handoverState.calls.every((c) => !c.enabled)).toBe(true);
    });

    it('shows the command and a Take this session button for a resumable worker', () => {
      handoverState.current = { resumable: true, command: "cd '/home/a1' && claude --resume sess-1", runtime: 'claude', landingLine: 'Lands in the home directory.', reason: null };
      render(<DecisionCard decision={decision()} askedBy="a1" ws="ws1" onAnswer={() => undefined} />);
      fireEvent.click(screen.getByText(/i need to do this myself/i));
      expect(screen.getByText('Lands in the home directory.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /take this session/i })).toBeInTheDocument();
    });

    it('shows the stated reason and no Take-session button for an unresumable worker', () => {
      handoverState.current = { resumable: false, command: null, runtime: 'gemini', landingLine: null, reason: 'gemini cannot resume a session outside the daemon.' };
      render(<DecisionCard decision={decision()} askedBy="a1" ws="ws1" onAnswer={() => undefined} />);
      fireEvent.click(screen.getByText(/i need to do this myself/i));
      expect(screen.getByText('gemini cannot resume a session outside the daemon.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /take this session/i })).not.toBeInTheDocument();
    });

    it('calls startHandover with the decision\'s workspace and asking agent', () => {
      handoverState.current = { resumable: true, command: 'claude --resume sess-1', runtime: 'claude', landingLine: null, reason: null };
      handoverState.startMutate = vi.fn();
      render(<DecisionCard decision={decision()} askedBy="a1" ws="ws1" onAnswer={() => undefined} />);
      fireEvent.click(screen.getByText(/i need to do this myself/i));
      fireEvent.click(screen.getByRole('button', { name: /take this session/i }));
      expect(handoverState.startMutate).toHaveBeenCalledWith({ ws: 'ws1', id: 'a1' }, expect.anything());
    });

    it('offers nothing on an answered (inert) card', () => {
      render(<DecisionCard decision={decision({ status: 'answered' })} askedBy="a1" ws="ws1" onAnswer={() => undefined} />);
      expect(screen.queryByText(/i need to do this myself/i)).not.toBeInTheDocument();
    });
  });
});

describe('Composer', () => {
  it('submits on Enter and clears', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'add dark mode' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('add dark mode', undefined, expect.any(String));
    await waitFor(() => expect(box.value).toBe(''));
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
    expect(onSubmit).toHaveBeenCalledWith('first line', undefined, expect.any(String));
  });

  it('asks the on-screen keyboard for a newline key on touch', () => {
    hoverNone(true);
    render(<Composer onSubmit={() => undefined} placeholder="Message the conductor…" />);
    expect(screen.getByLabelText('Message the conductor…')).toHaveAttribute('enterkeyhint', 'enter');
  });

  it('explains the queued state when the conductor is mid-turn', () => {
    render(<Composer onSubmit={() => undefined} queuedReason="Weaver is replying — your message is queued" queuedCount={1} />);
    expect(screen.getByText('Weaver is replying — your message is queued')).toBeInTheDocument();
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
    expect(onSubmit).toHaveBeenCalledWith('no attachment now', undefined, expect.any(String));
  });

  it('sends the pending files with the text, and clears both once the send resolves', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Composer onSubmit={onSubmit} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'look at this' } });
    fireEvent.click(screen.getByLabelText('Send'));

    expect(onSubmit).toHaveBeenCalledWith('look at this', [file], expect.any(String));
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

  // ---------- VS-277: dropping files ----------

  const dropZone = (): HTMLElement => screen.getByTestId('composer-drop-zone');

  it('adds a dropped file to the same pending state paste produces', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'dropped.png', { type: 'image/png' });
    fireEvent.drop(dropZone(), { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.getByText('dropped.png')).toBeInTheDocument();
  });

  it('rejects a disallowed-type drop, attaching nothing and reporting it', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropZone(), { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument();
    expect(screen.getByText(/Only images .* and plain text\/markdown/)).toBeInTheDocument();
  });

  it('attaches a mixed drop’s accepted files and reports the rest, as paste does', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const good = new File(['x'], 'shot.png', { type: 'image/png' });
    const bad = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropZone(), { dataTransfer: { types: ['Files'], files: [good, bad] } });
    expect(screen.getByText('shot.png')).toBeInTheDocument();
    expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument();
    expect(screen.getByText(/Only images .* and plain text\/markdown/)).toBeInTheDocument();
  });

  it('caps a dropped batch at four and says so', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const files = Array.from({ length: 5 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }));
    fireEvent.drop(dropZone(), { dataTransfer: { types: ['Files'], files } });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/At most 4 files per message/)).toBeInTheDocument();
  });

  it('highlights the composer while a file is dragged over it, and clears when it leaves', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const zone = dropZone();
    expect(zone.className).not.toContain('border-accent');
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone.className).toContain('border-accent');
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone.className).not.toContain('border-accent');
  });

  it('ignores a non-file drag: no highlight, no attach, no preventDefault', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const zone = dropZone();
    expect(fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'] } })).toBe(true);
    expect(zone.className).not.toContain('border-accent');
    expect(fireEvent.dragOver(zone, { dataTransfer: { types: ['text/plain'] } })).toBe(true);
    expect(fireEvent.drop(zone, { dataTransfer: { types: ['text/plain'], files: [] } })).toBe(true);
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('does not highlight or attach a file dropped where attachments are not allowed', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message the conductor…" />);
    const zone = dropZone();
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone.className).not.toContain('border-accent');
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();
  });

  it('refuses the browser default for a file drag so a drop cannot navigate away', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    expect(fireEvent.dragOver(dropZone(), { dataTransfer: { types: ['Files'], files: [] } })).toBe(false);
    expect(fireEvent.drop(dropZone(), { dataTransfer: { types: ['Files'], files: [file] } })).toBe(false);
  });

  it('refuses the browser default for a file dropped outside the composer, attaching nothing', () => {
    render(<Composer onSubmit={() => undefined} allowAttachments placeholder="Message the conductor…" />);
    const file = new File(['x'], 'outside.png', { type: 'image/png' });
    // The window guard, not the composer: the drop zone is not in this event's path.
    expect(fireEvent.dragOver(window, { dataTransfer: { types: ['Files'], files: [] } })).toBe(false);
    expect(fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [file] } })).toBe(false);
    expect(screen.queryByText('outside.png')).not.toBeInTheDocument();
  });

  it('disables send and ignores a second tap while the first request is in flight', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'once' } });
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText('Send')).toBeDisabled());
    expect(screen.getByRole('status')).toHaveTextContent('Sending…');
    resolve();
    await waitFor(() => expect(box.value).toBe(''));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('re-enables send once a failed request settles, and keeps the typed text', async () => {
    let reject!: (e: Error) => void;
    const onSubmit = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'keep me' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByLabelText('Send')).toBeDisabled());
    reject(new Error('nope'));
    await waitFor(() => expect(screen.getByLabelText('Send')).not.toBeDisabled());
    expect(box.value).toBe('keep me');
    expect(screen.getByRole('alert')).toHaveTextContent(/Message not sent/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows Uploading and sending… while an attachment send is in flight', async () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => { /* pending */ }));
    render(<Composer onSubmit={onSubmit} allowAttachments placeholder="Message the conductor…" />);
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('Message the conductor…'), { target: { value: 'look' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Uploading and sending…'));
  });

  it('reuses the idempotency key on an unedited retry, and issues a new one after an edit', async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'));
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'same' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Message not sent/));
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Message not sent/));
    const first = onSubmit.mock.calls[0]![2] as string;
    const second = onSubmit.mock.calls[1]![2] as string;
    expect(second).toBe(first);

    fireEvent.change(box, { target: { value: 'edited' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]![2]).not.toBe(first);
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

  it('shows nothing while the tab is hidden (VS-227)', () => {
    const { container } = render(<ConnectionBanner state="hidden" capturedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the capture time when offline', () => {
    render(<ConnectionBanner state="offline" capturedAt="2026-09-01T09:38:00.000Z" queuedCount={2} />);
    expect(screen.getByText(/Offline — showing the state from/)).toBeInTheDocument();
    expect(screen.getByText('2 queued')).toBeInTheDocument();
  });

  it('shows the last-frame age while stale, not a fresh connected state (VS-641)', () => {
    render(<ConnectionBanner state="stale" capturedAt={null} lastFrameAt={Date.parse('2026-09-01T09:38:00.000Z')} />);
    expect(screen.getByText(/No updates since/)).toBeInTheDocument();
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
    render(<DecisionCard decision={reviewed()} plan={<PlanPreview decision={reviewed()} />} onAnswer={() => undefined} />);
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

describe('the document a decision target points at (VS-224)', () => {
  const headDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    data: { key: 'action', documentId: 'doc_1', revision: 2, currentRevision: 2, body: 'systemctl restart acd', createdAt: '', ...over },
    isLoading: false,
    isError: false,
  });
  const namedDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    data: { key: 'action', documentId: 'doc_1', revision: 2, currentRevision: 3, body: 'older revision body', createdAt: '', ...over },
    isLoading: false,
    isError: false,
  });
  const actionDecision = decision({
    kind: 'action_approval',
    title: 'Approve the action for ACME-25: deploy the headers',
    context: 'Review the action document below — approve to run it; revise to send feedback; reject to cancel.',
    target: { documentId: 'doc_1', revision: 2 },
    options: [
      { key: 'approve', label: 'Approve', recommended: true },
      { key: 'revise', label: 'Revise…' },
      { key: 'reject', label: 'Reject' },
    ],
  });

  it('shows the action document on the card with the revision it names, open by default', () => {
    docById.head = headDoc();
    docById.named = null;
    docById.calls = [];
    render(<DecisionCard decision={actionDecision} onAnswer={() => undefined} />);
    expect(screen.getByText('systemctl restart acd')).toBeInTheDocument();
    expect(screen.getByText('r2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide the document/ })).toHaveAttribute('aria-expanded', 'true');
    // One HEAD request; the revision-named call shares its cache key.
    expect(docById.calls.map((c) => c[2])).toEqual([undefined, undefined]);
  });

  it('renders the document for a decision of another kind carrying the same target shape', () => {
    docById.head = headDoc({ documentId: 'doc_9', revision: 1, currentRevision: 1, body: 'generic document body' });
    docById.named = null;
    docById.calls = [];
    render(<DecisionCard decision={question({ target: { documentId: 'doc_9', revision: 1 } })} onAnswer={() => undefined} />);
    expect(screen.getByText('generic document body')).toBeInTheDocument();
  });

  it('leaves decisions without a document target exactly as they are, fetching nothing', () => {
    docById.head = headDoc({ body: 'must not appear' });
    docById.named = null;
    docById.calls = [];
    render(
      <DecisionCard
        decision={reviewed({ kind: 'merge_approval', target: { prUrl: 'https://git.example/acme/web/pull/12', prNumber: 12, ci: { passed: 2, total: 2 } } })}
        ws="ws1"
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /Approve merge/ })).toBeInTheDocument();
    expect(screen.queryByText('must not appear')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read the document' })).not.toBeInTheDocument();
    expect(docById.calls).toHaveLength(0);
  });

  it('never shows a superseded revision as current', () => {
    docById.head = headDoc({ revision: 3, currentRevision: 3, body: 'current head body' });
    docById.named = namedDoc();
    docById.calls = [];
    render(<DecisionCard decision={actionDecision} onAnswer={() => undefined} />);
    expect(screen.getByText(/revised since this was asked/)).toBeInTheDocument();
    expect(screen.getByText(/superseded by r3/)).toBeInTheDocument();
    expect(screen.getByText('older revision body')).toBeInTheDocument();
    expect(screen.queryByText('current head body')).not.toBeInTheDocument();
  });

  it('says when the revision it names does not exist instead of passing off HEAD content', () => {
    docById.head = headDoc({ revision: 3, currentRevision: 3 });
    docById.named = null;
    docById.calls = [];
    render(<DecisionCard decision={decision({ ...actionDecision, target: { documentId: 'doc_1', revision: 5 } })} onAnswer={() => undefined} />);
    expect(screen.getByText('Revision r5 could not be found — the document is at r3.')).toBeInTheDocument();
    expect(screen.queryByText('systemctl restart acd')).not.toBeInTheDocument();
  });

  it('says so when the document cannot be read at all', () => {
    docById.head = null;
    docById.named = null;
    docById.calls = [];
    render(<DecisionCard decision={actionDecision} onAnswer={() => undefined} />);
    expect(screen.getByText('The document this decision points at could not be found.')).toBeInTheDocument();
  });

  it('holds the space with a skeleton while the document loads', () => {
    docById.head = { data: undefined, isLoading: true, isError: false };
    docById.named = null;
    docById.calls = [];
    render(<DocumentPreview decision={actionDecision} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('renders a plan approval exactly once, through the plan slot, and never fetches by id', () => {
    docById.head = headDoc({ key: 'plan', documentId: 'doc_plan', body: 'general preview body' });
    docById.named = null;
    docById.calls = [];
    const d = decision({ target: { documentId: 'doc_plan', revision: 1 } });
    render(<DecisionCard decision={d} plan={<PlanPreview decision={d} />} onAnswer={() => undefined} />);
    expect(screen.getByRole('button', { name: /Read the plan/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read the document/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hide the document/ })).not.toBeInTheDocument();
    expect(screen.queryByText('general preview body')).not.toBeInTheDocument();
    expect(docById.calls).toHaveLength(0);
  });

  it('shows an answered plan approval its plan as a record through the general preview', () => {
    docById.head = headDoc({ key: 'plan', documentId: 'doc_plan', revision: 1, currentRevision: 1, body: 'the approved plan' });
    docById.named = null;
    docById.calls = [];
    const d = decision({ status: 'answered', answerKey: 'approve', answeredAt: '2026-09-11T10:00:00.000Z', target: { documentId: 'doc_plan', revision: 1 } });
    render(<DecisionCard decision={d} plan={<PlanPreview decision={d} />} onAnswer={() => undefined} />);
    const toggle = screen.getByRole('button', { name: /Read the document/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('the approved plan')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('the approved plan')).toBeInTheDocument();
  });
});


