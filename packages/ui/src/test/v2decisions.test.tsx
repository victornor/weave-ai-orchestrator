/**
 * VS-345: the V2 decision card — neutral header, review states, the held state with its
 * reason-required override, every input kind, relayed answers, artifacts and the narrow variant.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import type { Run } from '@weave-ai/shared';
import { agent, decision as makeDecision, run as makeRun, ticket, workProduct } from './factories';

const state = vi.hoisted(() => ({
  products: [] as ReturnType<typeof workProduct>[],
  runs: [] as Run[],
  detail: null as {
    ticket: ReturnType<typeof ticket>;
    worker: ReturnType<typeof agent> | null;
    blockers: ReturnType<typeof ticket>[];
  } | null,
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => '/v2/needs',
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => () => undefined,
}));
vi.mock('../api/hooks', () => ({
  useTicketWorkProducts: () => ({ data: state.products, isLoading: false }),
  useTicketFor: () => ({ data: state.detail }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentById: () => ({ data: undefined, isLoading: false, isError: true }),
  useRuns: () => ({ data: state.runs }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
}));

const { V2DecisionCard } = await import('../v2/DecisionCard');

function renderCard(props: Partial<ComponentProps<typeof V2DecisionCard>> = {}) {
  const onAnswer = vi.fn();
  const utils = render(<V2DecisionCard decision={makeDecision()} ws="ws1" onAnswer={onAnswer} {...props} />);
  return { onAnswer, ...utils };
}

beforeEach(() => {
  state.products = [];
  state.runs = [];
  state.detail = null;
});

describe('the V2 decision card header', () => {
  it('uses neutral text, with no status glyph, and names the ticket, project and asking agent', () => {
    renderCard({ ticketIdentifier: 'ACME-51', projectLabel: 'api', askedBy: 'a1', askedByName: 'Backend Engineer #7' });
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText('ACME-51 · api · Backend Engineer #7')).toBeInTheDocument();
  });

  it('never shows the asking agent id when its name is unknown', () => {
    renderCard({ ticketIdentifier: 'ACME-51', projectLabel: 'api', askedBy: 'a1' });
    const meta = screen.getByText(/^ACME-51 · api ·/);
    expect(meta.textContent).toContain('an agent');
    expect(meta.textContent).not.toContain('a1');
  });

  it('names a worker question as a Worker question when the asker is a worker', () => {
    renderCard({ decision: makeDecision({ kind: 'question' }), asker: 'worker' });
    expect(screen.getByText('Worker question')).toBeInTheDocument();
  });

  it('stays neutral for a question whose asker is unknown', () => {
    renderCard({ decision: makeDecision({ kind: 'question', title: 'Where should this live?' }) });
    expect(screen.queryByText('Worker question')).toBeNull();
    expect(screen.getByRole('article', { name: 'Needs you: Where should this live?' })).toBeInTheDocument();
  });
});

describe('the card shell (VS-414)', () => {
  it('uses the visible card border token so stacked cards do not blur together', () => {
    renderCard({ ticketIdentifier: 'ACME-42' });
    expect(screen.getByRole('article').className).toContain('border-line-2');
  });

  it('keeps a destructive card on the blocked border instead', () => {
    renderCard({ decision: makeDecision({ kind: 'discard_approval' }), ticketIdentifier: 'ACME-42' });
    const card = screen.getByRole('article').className;
    expect(card).toContain('border-blocked/35');
    expect(card).not.toContain('border-line-2');
  });

  it('never shrinks in the chat pane column, so its bottom action row is not clipped', () => {
    renderCard({ narrow: true, ticketIdentifier: 'ACME-42' });
    expect(screen.getByRole('article').className).toContain('shrink-0');
  });
});

describe('the compact type scale (VS-418)', () => {
  const context = 'Token layer first, then a theme provider, then sweep the 41 hard-coded colours.';

  const assertCompact = (): void => {
    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toHaveClass('text-ui');
    expect(title).not.toHaveClass('text-head');
    const body = screen.getByText(context).closest('.ac-prose');
    expect(body).not.toBeNull();
    expect(body).toHaveClass('text-meta');
  };

  it('renders the compact title and body tokens on the wide card', () => {
    renderCard();
    assertCompact();
  });

  it('renders the same compact title and body tokens on the narrow card', () => {
    renderCard({ narrow: true, ticketIdentifier: 'ACME-42' });
    assertCompact();
  });
});

describe('the held card', () => {
  const held = makeDecision({
    kind: 'merge_approval',
    status: 'open',
    weaverReviewStatus: 'concerns',
    weaverReviewedAt: '2026-09-13T10:00:00.000Z',
    weaverReviewNote: 'Storage write runs on every render.',
  });

  /** Seed the card's ticket detail so the held row can read the ticket's worker and status. */
  function hold(worker: ReturnType<typeof agent> | null, over: { status?: 'blocked'; blockers?: ReturnType<typeof ticket>[] } = {}): void {
    state.detail = { ticket: ticket({ ...(over.status ? { status: over.status } : {}) }), worker, blockers: over.blockers ?? [] };
  }

  /** The pulsing dot on the revision row, if the row is pulsing. */
  const row = (): HTMLElement => document.querySelector('[data-revision-row]') as HTMLElement;
  const pulsing = (): boolean => row().firstElementChild!.className.includes('animate-pulse');

  it('shows the objection, a pulsing revision row when the worker is running, Watch, a disabled Approve and the blocked copy', () => {
    hold(agent({ id: 'a1', status: 'running' }));
    state.runs = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running', startedAt: '2026-09-14T17:30:00.000Z' })];
    renderCard({ decision: held, ticketIdentifier: 'ACME-42', askedBy: 'a1' });
    expect(screen.getByText('Storage write runs on every render.')).toBeInTheDocument();
    expect(screen.getByText(/Revision in progress/)).toBeInTheDocument();
    expect(pulsing()).toBe(true);
    expect(screen.getByRole('button', { name: 'Watch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve merge' })).toBeDisabled();
    expect(screen.getByText('Approval is blocked until a revision lands.')).toBeInTheDocument();
  });

  it('says the worker is paused, with the reason, instead of claiming a revision', () => {
    hold(agent({ id: 'a1', status: 'paused', pauseReason: 'waiting on the npm publish' }));
    renderCard({ decision: held, ticketIdentifier: 'ACME-42', askedBy: 'a1' });
    expect(screen.getByText(/Held — worker paused: waiting on the npm publish/)).toBeInTheDocument();
    expect(screen.queryByText(/Revision in progress/)).toBeNull();
    expect(pulsing()).toBe(false);
  });

  it('says it is waiting on the worker between turns, timed from the last run', () => {
    hold(agent({ id: 'a1', status: 'active' }));
    state.runs = [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded', startedAt: '2026-09-14T00:00:00.000Z', finishedAt: '2026-09-14T01:00:00.000Z' })];
    renderCard({ decision: held, ticketIdentifier: 'ACME-42', askedBy: 'a1' });
    expect(screen.getByText(/Held for a revision — waiting on the worker/)).toBeInTheDocument();
    expect(screen.queryByText(/Revision in progress/)).toBeNull();
    expect(pulsing()).toBe(false);
  });

  it('names the blocker when the ticket is blocked', () => {
    hold(agent({ id: 'a1', status: 'active' }), { status: 'blocked', blockers: [ticket({ id: 'tk_7', identifier: 'ACME-7', status: 'todo' })] });
    renderCard({ decision: held, ticketIdentifier: 'ACME-42', askedBy: 'a1' });
    expect(screen.getByText('Held — blocked: ACME-7')).toBeInTheDocument();
    expect(pulsing()).toBe(false);
  });

  it('says there is no worker when the ticket has none', () => {
    hold(null);
    renderCard({ decision: held, ticketIdentifier: 'ACME-42', askedBy: 'a1' });
    expect(screen.getByText('Held — no worker')).toBeInTheDocument();
    expect(pulsing()).toBe(false);
  });

  it('expands the worker feed on Watch, independently per card', () => {
    render(
      <>
        <V2DecisionCard decision={held} ws="ws1" onAnswer={() => undefined} />
        <V2DecisionCard decision={makeDecision({ ...held, id: 'd2' })} ws="ws1" onAnswer={() => undefined} />
      </>,
    );
    const watches = screen.getAllByRole('button', { name: 'Watch' });
    expect(screen.queryAllByText(/No run yet/)).toHaveLength(0);
    fireEvent.click(watches[0]!);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
    // The opened Watch pane is resizable (VS-409).
    expect(screen.getByRole('separator', { name: 'Resize trace pane' })).toBeInTheDocument();
    // The second card is untouched: exactly one feed is open.
    expect(screen.getAllByText(/No run yet/)).toHaveLength(1);
  });

  it('requires a reason before Override and approve is available, then sends the override', () => {
    const { onAnswer } = renderCard({ decision: held, ticketIdentifier: 'ACME-42' });
    fireEvent.click(screen.getByRole('button', { name: 'Override…' }));
    const submit = screen.getByRole('button', { name: 'Override and approve' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why override the hold?'), { target: { value: 'Time-boxed release; filing a fix.' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onAnswer).toHaveBeenCalledWith({
      key: 'approve',
      overrideHold: true,
      overrideReason: 'Time-boxed release; filing a fix.',
    });
  });

  it('treats an unreviewed decision as unreviewed, not as a revision hold', () => {
    renderCard({ decision: makeDecision({ kind: 'plan_approval', weaverReviewStatus: 'unseen' }), plan: <div>plan</div> });
    expect(screen.getByText("Weaver hasn't reviewed yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.queryByText(/Revision in progress/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Watch' })).toBeNull();
    expect(screen.queryByText('Approval is blocked until a revision lands.')).toBeNull();
    expect(screen.getByText("Approval waits on the weaver's review — you can override it.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override & approve…' })).toBeInTheDocument();
  });
});

describe('inputs', () => {
  const single = makeDecision({
    kind: 'question',
    options: [],
    inputs: [
      {
        key: 'storage',
        label: 'Where should the preference live?',
        type: 'single_choice',
        required: true,
        choices: [
          { key: 'cookie', label: 'Cookie', recommended: true },
          { key: 'user', label: 'User record' },
        ],
      },
    ],
  });

  it('marks and pre-selects the recommended single choice, then answers with its key', () => {
    const { onAnswer } = renderCard({ decision: single });
    expect(screen.getByText('RECOMMENDED')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Cookie/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith({ inputs: { storage: 'cookie' } });
  });

  it('keeps the answer unavailable while a required input is empty and names it', () => {
    const requiredText = makeDecision({
      kind: 'question',
      options: [],
      inputs: [{ key: 'note', label: 'Your note', type: 'text', required: true }],
    });
    renderCard({ decision: requiredText });
    expect(screen.getByText('Your note is needed before this can be sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  });

  it('masks a secret and submits it under its secretName', () => {
    const secret = makeDecision({
      kind: 'question',
      options: [],
      inputs: [{ key: 'token', label: 'API token', type: 'secret', required: true, secretName: 'ACME_TOKEN' }],
    });
    const { onAnswer } = renderCard({ decision: secret });
    const field = screen.getByLabelText(/API token/);
    expect(field).toHaveAttribute('type', 'password');
    fireEvent.change(field, { target: { value: 's3cret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith({ inputs: { token: 's3cret' } });
  });
});

describe('the answered card is a record', () => {
  it('shows the answer, the relay copy, and offers no actions', () => {
    renderCard({
      decision: makeDecision({
        status: 'answered',
        answerKey: 'approve',
        answeredAt: '2026-09-13T11:00:00.000Z',
        relayedFromMessageId: 'msg_1',
      }),
    });
    expect(screen.getByText("The human's words, recorded by the weaver from their message.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});

describe('answering in words and sending a merge back', () => {
  it('labels a recommended option RECOMMENDED, not picked', () => {
    renderCard({
      decision: makeDecision({
        kind: 'question',
        options: [
          { key: 'cookie', label: 'Cookie', recommended: true },
          { key: 'user', label: 'User record' },
        ],
      }),
    });
    expect(screen.getByText('RECOMMENDED')).toBeInTheDocument();
    expect(screen.queryByText('PICKED')).toBeNull();
  });

  it('sends a free-text answer written into an option card', () => {
    const { onAnswer } = renderCard({
      decision: makeDecision({ kind: 'question', options: [{ key: 'cookie', label: 'Cookie' }], allowFreeText: true }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Write your own…' }));
    fireEvent.change(screen.getByLabelText('Answer in your own words'), { target: { value: 'Neither — use the session.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith({ text: 'Neither — use the session.' });
  });

  it('answers an open-ended question that has no options and no inputs', () => {
    const { onAnswer } = renderCard({
      decision: makeDecision({ kind: 'question', options: [], inputs: [], allowFreeText: true }),
    });
    fireEvent.change(screen.getByLabelText('Answer in your own words'), { target: { value: 'Use the cookie.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith({ text: 'Use the cookie.' });
  });

  it('sends a merge back with a change request', () => {
    const { onAnswer } = renderCard({ decision: makeDecision({ kind: 'merge_approval' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes…' }));
    fireEvent.change(screen.getByLabelText('What should change before this merges?'), { target: { value: 'Add a rollback test.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(onAnswer).toHaveBeenCalledWith({ key: 'changes', text: 'Add a rollback test.' });
  });
});

describe('artifacts and the narrow variant', () => {
  it('links the ticket artifact when it has one', () => {
    state.products = [workProduct({ type: 'artifact', externalId: 'overview', title: 'How theming resolves' })];
    renderCard({ ticketIdentifier: 'ACME-42' });
    expect(screen.getByRole('link', { name: 'How theming resolves' })).toHaveAttribute(
      'href',
      '/v2/w/ws1/tickets/tk_1/artifacts/overview',
    );
  });

  it('renders the work-product link and Ask the worker in the narrow variant', () => {
    renderCard({ narrow: true, ticketIdentifier: 'ACME-42' });
    expect(screen.getByRole('link', { name: 'Ask the worker' })).toHaveAttribute('href', '/v2/w/ws1/tickets/tk_1');
  });
});

describe('the approve call to action (VS-418)', () => {
  it('fills the Approve button and greens a clean review when approval is ready', () => {
    renderCard({
      decision: makeDecision({ kind: 'merge_approval', weaverReviewStatus: 'looked', weaverReviewNote: 'Read the diff.' }),
      ticketIdentifier: 'ACME-42',
    });
    const approve = screen.getByRole('button', { name: 'Approve merge' });
    expect(approve).toBeEnabled();
    expect(approve).toHaveAttribute('data-variant', 'primary');
    expect(approve).toHaveAttribute('data-approve', 'ready');
    expect(screen.getByText('Weaver reviewed — no concerns')).toHaveClass('text-review-clean');
  });

  it('mutes the Approve button and warns the review while the weaver holds concerns', () => {
    renderCard({
      decision: makeDecision({
        kind: 'merge_approval',
        weaverReviewStatus: 'concerns',
        weaverReviewNote: 'Storage write runs on every render.',
      }),
      ticketIdentifier: 'ACME-42',
    });
    const approve = screen.getByRole('button', { name: 'Approve merge' });
    expect(approve).toBeDisabled();
    expect(approve).not.toHaveAttribute('data-variant');
    expect(approve).toHaveAttribute('data-approve', 'blocked');
    expect(screen.getByText('Weaver reviewed — has concerns')).toHaveClass('text-blocked');
  });

  it('treats a missing required input as blocked, not ready', () => {
    renderCard({
      decision: makeDecision({
        kind: 'plan_approval',
        weaverReviewStatus: 'looked',
        options: [],
        inputs: [{ key: 'note', label: 'Your note', type: 'text', required: true }],
      }),
      plan: <div>plan</div>,
    });
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('data-approve', 'blocked');
    expect(approve).not.toHaveAttribute('data-variant');
  });
});
