/**
 * VS-552: dictation on the V2 decision card's free-text surfaces.
 *
 * The same control and behaviour as the V2 chat composer — the free-text answer on an option card, a
 * `text` and a `multiline` input, and the `allowOther` answer of a `single_choice` — with a `secret`
 * input deliberately excluded. Driven through the real `useDictation` against a fake recognizer, so
 * the transcript lands through the same path the composer uses.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { decision as makeDecision } from './factories';

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => '/needs',
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
  useTicketWorkProducts: () => ({ data: [], isLoading: false }),
  useTicketFor: () => ({ data: null }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentById: () => ({ data: undefined, isLoading: false, isError: true }),
  useRuns: () => ({ data: [] }),
}));
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
}));

const { V2DecisionCard } = await import('../v2/DecisionCard');

interface ResultLike { isFinal: boolean; length: number; 0: { transcript: string } }

class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: { resultIndex: number; results: ResultLike[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
}

function said(...parts: [string, boolean][]): { resultIndex: number; results: ResultLike[] } {
  const firstInterim = parts.findIndex(([, isFinal]) => !isFinal);
  return {
    resultIndex: firstInterim === -1 ? Math.max(parts.length - 1, 0) : firstInterim,
    results: parts.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } })),
  };
}

const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

function renderCard(over: Parameters<typeof makeDecision>[0] = {}): void {
  render(<V2DecisionCard decision={makeDecision(over)} ws="ws1" onAnswer={vi.fn()} />);
}

/** Start the dictation at `testId`, hand it a final transcript, stop and settle — the composer path. */
function dictateInto(testId: string, transcript: string): void {
  fireEvent.click(screen.getByTestId(testId));
  const rec = FakeRecognition.last!;
  act(() => rec.onresult!(said([transcript, true])));
  fireEvent.click(screen.getByTestId(testId));
  act(() => rec.onend!());
}

beforeEach(() => {
  FakeRecognition.last = null;
  w.webkitSpeechRecognition = FakeRecognition;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});

afterEach(() => {
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
  vi.unstubAllGlobals();
});

describe('dictation on the V2 decision card free-text surfaces (VS-552)', () => {
  it('offers dictation on a multiline input and inserts into what is already typed', async () => {
    renderCard({ kind: 'question', options: [], inputs: [{ key: 'notes', label: 'Your notes', type: 'multiline' }] });
    fireEvent.change(screen.getByLabelText('Your notes'), { target: { value: 'typed' } });

    dictateInto('v2-dc-dictate-notes', 'yes do that');

    await waitFor(() => expect(screen.getByLabelText('Your notes')).toHaveValue('typed yes do that'));
  });

  it('offers dictation on a text input', async () => {
    renderCard({ kind: 'question', options: [], inputs: [{ key: 'note', label: 'Your note', type: 'text' }] });

    dictateInto('v2-dc-dictate-note', 'yes do that');

    await waitFor(() => expect(screen.getByLabelText('Your note')).toHaveValue('yes do that'));
  });

  it('offers dictation on the free-text answer of a card with options', async () => {
    renderCard({ kind: 'question', options: [{ key: 'cookie', label: 'Cookie' }], allowFreeText: true });
    fireEvent.click(screen.getByRole('button', { name: 'Write your own…' }));

    dictateInto('v2-dc-dictate-answer', 'neither use the session');

    await waitFor(() => expect(screen.getByLabelText('Answer in your own words')).toHaveValue('neither use the session'));
  });

  it('offers dictation on the allowOther answer of a single_choice input', async () => {
    renderCard({
      kind: 'question',
      options: [],
      inputs: [{
        key: 'storage', label: 'Where should the preference live?', type: 'single_choice', allowOther: true,
        choices: [{ key: 'cookie', label: 'Cookie' }],
      }],
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Write your own…' }));

    dictateInto('v2-dc-dictate-storage', 'use the user record');

    await waitFor(() => expect(screen.getByLabelText(/your own answer/)).toHaveValue('use the user record'));
  });

  it('does not offer dictation on a secret input', () => {
    renderCard({
      kind: 'question',
      options: [],
      inputs: [
        { key: 'token', label: 'API token', type: 'secret', secretName: 'ACME_TOKEN' },
        { key: 'note', label: 'Your note', type: 'text' },
      ],
    });

    expect(screen.queryByTestId('v2-dc-dictate-token')).toBeNull();
    // The neighbouring text input does offer it: the absence is the secret's, not the card's.
    expect(screen.getByTestId('v2-dc-dictate-note')).toBeInTheDocument();
  });

  it('restores the field exactly when the transcript is below three words', async () => {
    renderCard({ kind: 'question', options: [], inputs: [{ key: 'notes', label: 'Your notes', type: 'multiline' }] });
    fireEvent.change(screen.getByLabelText('Your notes'), { target: { value: 'typed' } });

    dictateInto('v2-dc-dictate-notes', 'one two');

    await waitFor(() => expect(screen.getByLabelText('Your notes')).toHaveValue('typed'));
  });
});
