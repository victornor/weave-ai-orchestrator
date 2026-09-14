/**
 * VS-349 / VS-370: the V2 chat trace — narration italic in a dimmer ink, a tool row naming the tool
 * and its argument, result lines behind their call, grouped same-name calls collapsed to one counted
 * line, output bounded in a scroll container, and the collapsed turn summary that omits a quantity
 * the runtime never reported.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunTrace } from '@weave-ai/shared';

const state = vi.hoisted(() => ({ events: [] as RunEvent[] }));

vi.mock('../api/hooks', () => ({ useRunEvents: () => ({ data: state.events }) }));

const { ChatTrace, ChatTurnTrace } = await import('../v2/ChatTrace');

function event(over: Partial<RunEvent> & { type: RunEvent['type'] }): RunEvent {
  return { id: 'e', runId: 'r1', seq: 1, ts: '2026-09-13T09:00:00.000Z', stream: 'stdout', level: 'info', payload: {}, ...over };
}

const narration = event({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the file first.' } });
const call = event({ id: 'e2', seq: 2, type: 'tool.call', payload: { name: 'Read', callId: 'c1', target: 'src/x.ts' } });
const result = event({ id: 'e3', seq: 3, type: 'tool.result', payload: { callId: 'c1', diff: '- old\n+ new' } });

/** One Bash call and its result, as the trace receives them. */
function bashCall(id: string, seq: number, callId: string, command: string, output: string): RunEvent[] {
  return [
    event({ id, seq, type: 'tool.call', payload: { name: 'Bash', callId, input: { command } } }),
    event({ id: `${id}-r`, seq: seq + 1, type: 'tool.result', payload: { callId, output } }),
  ];
}

const trace: RunTrace = {
  runId: 'r1', status: 'succeeded', agentId: 'weaver1', createdAt: '2026-09-13T09:00:00.000Z',
  startedAt: '2026-09-13T09:00:00.000Z', finishedAt: '2026-09-13T09:00:34.000Z', durationMs: 34_000,
  toolCalls: 7, files: 0, errors: 0, texts: 2, events: 10, summary: null, model: 'sonnet',
  usage: { inputTokens: 10_000, outputTokens: 8_400, cachedInputTokens: 0, basis: 'reported' },
};

beforeEach(() => {
  state.events = [];
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the V2 chat trace', () => {
  it('renders narration italic in a dimmer ink', () => {
    render(<ChatTrace events={[narration, call, result]} />);
    const el = document.querySelector('[data-trace-narration]') as HTMLElement;
    expect(el.className).toMatch(/italic/);
    expect(el.className).toMatch(/text-text-4/);
    expect(el).toHaveTextContent('Reading the file first.');
  });

  it('names the tool and its argument, with the result behind the call until it is opened', () => {
    render(<ChatTrace events={[narration, call, result]} />);
    const tool = document.querySelector('[data-trace-tool]') as HTMLElement;
    expect(tool).toHaveTextContent('Read');
    expect(tool).toHaveTextContent('src/x.ts');
    // The result is collapsed by default (VS-370): no result container until the row is opened.
    expect(document.querySelector('[data-trace-result]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Read, src/x.ts' }));
    const res = document.querySelector('[data-trace-result]') as HTMLElement;
    expect(res.style.paddingLeft).toBe('2ch');
    // The result follows its call in document order.
    expect(tool.compareDocumentPosition(res) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses three consecutive same-tool calls into one ×3 line, and hides the calls and their output until opened', () => {
    const three = [
      ...bashCall('b1', 1, 'c1', 'ls a', 'a1\na2'),
      ...bashCall('b2', 3, 'c2', 'ls b', 'b1\nb2'),
      ...bashCall('b3', 5, 'c3', 'ls c', 'c1\nc2'),
    ];
    render(<ChatTrace events={three} />);
    expect(screen.getByText('Bash ×3')).toBeInTheDocument();
    expect(screen.queryByText('ls a')).toBeNull();
    expect(screen.queryByText('a1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bash, 3 calls' }));
    expect(screen.getByText('ls a')).toBeInTheDocument();
    expect(screen.getByText('ls c')).toBeInTheDocument();
    // Each call keeps its own result behind its own disclosure (V1's density).
    expect(screen.queryByText('a1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bash, ls a' }));
    expect(screen.getByText('a1')).toBeInTheDocument();
  });

  it('keeps an opened group open when a new event arrives', () => {
    const three = [
      ...bashCall('b1', 1, 'c1', 'ls a', 'a1'),
      ...bashCall('b2', 3, 'c2', 'ls b', 'b1'),
      ...bashCall('b3', 5, 'c3', 'ls c', 'c1'),
    ];
    const { rerender } = render(<ChatTrace events={three} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bash, 3 calls' }));
    expect(screen.getByText('ls a')).toBeInTheDocument();

    rerender(<ChatTrace events={[...three, ...bashCall('b4', 7, 'c4', 'ls d', 'd1')]} />);
    expect(screen.getByText('Bash ×4')).toBeInTheDocument();
    expect(screen.getByText('ls c')).toBeInTheDocument();
  });

  it('caps a long tool result in a scrollable container', () => {
    const long = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
    render(<ChatTrace events={bashCall('b1', 1, 'c1', 'cat big', long)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bash, cat big' }));
    const res = document.querySelector('[data-trace-result]') as HTMLElement;
    expect(res).not.toBeNull();
    expect(res).toHaveClass('ac-scroll');
    expect(res).toHaveClass('max-h-40');
  });

  it('caps a long command output in the same scrollable container', () => {
    const long = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
    render(<ChatTrace events={[event({ id: 'x', seq: 1, type: 'command.executed', payload: { command: 'cat big', exitCode: 0, stdout: long } })]} />);
    const res = document.querySelector('[data-trace-result]') as HTMLElement;
    expect(res).not.toBeNull();
    expect(res).toHaveClass('ac-scroll');
    expect(res).toHaveClass('max-h-40');
  });

  it('shows an edit call with its diff expanded, with no click', () => {
    render(
      <ChatTrace
        events={[event({ id: 'e1', seq: 1, type: 'tool.call', payload: { name: 'Edit', callId: 'c1', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } } })]}
      />,
    );
    expect(screen.getByText('a.ts')).toHaveAttribute('title', 'src/a.ts');
    // VS-413: visible on first render, not behind a click.
    const body = document.querySelector('[data-trace-edit]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body).toHaveClass('ac-scroll');
    // Tall enough to read a typical edit (VS-413), not VS-370's 160px strip.
    expect(body).toHaveClass('max-h-96');
    expect(body).toHaveTextContent('const x = 1;');
    expect(body).toHaveTextContent('const x = 2;');
  });

  it('shows a write call with its written file expanded, with no click', () => {
    render(
      <ChatTrace
        events={[event({ id: 'e1', seq: 1, type: 'tool.call', payload: { name: 'Write', callId: 'c1', input: { file_path: 'src/b.ts', content: 'export const b = 1;\nexport const c = 2;' } } })]}
      />,
    );
    expect(screen.getByText('b.ts')).toHaveAttribute('title', 'src/b.ts');
    expect(document.querySelector('[data-trace-edit]') as HTMLElement).toHaveTextContent('export const b = 1;');
  });

  it('shows only a file target\'s base name, keeping the whole path in the title (VS-437)', () => {
    render(
      <ChatTrace
        events={[
          event({ id: 'e1', seq: 1, type: 'tool.call', payload: { name: 'Read', callId: 'c1', input: { file_path: '/abs/dir/readme.md' } } }),
          event({ id: 'e2', seq: 2, type: 'tool.call', payload: { name: 'Bash', callId: 'c2', input: { command: 'cd /abs/dir && ls' } } }),
        ]}
      />,
    );
    expect(screen.getByText('readme.md')).toHaveAttribute('title', '/abs/dir/readme.md');
    // A shell command keeps the whole command, and gains no tooltip.
    expect(screen.getByText('cd /abs/dir && ls')).not.toHaveAttribute('title');
  });

  it('never folds consecutive edits into a collapsed group: three edits are three expanded diffs', () => {
    const edit = (id: string, seq: number, path: string, from: string, to: string): RunEvent =>
      event({ id, seq, type: 'tool.call', payload: { name: 'Edit', callId: id, input: { file_path: path, old_string: from, new_string: to } } });
    render(
      <ChatTrace
        events={[
          edit('e1', 1, 'src/a.ts', 'const a = 1;', 'const a = 2;'),
          edit('e2', 2, 'src/b.ts', 'const b = 1;', 'const b = 2;'),
          edit('e3', 3, 'src/c.ts', 'const c = 1;', 'const c = 2;'),
        ]}
      />,
    );
    expect(screen.queryByText('Edit ×3')).toBeNull();
    const bodies = document.querySelectorAll('[data-trace-edit]');
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toHaveTextContent('const a = 1;');
    expect(bodies[2]).toHaveTextContent('const c = 2;');
  });

  it('collapses an edit by its own header, and stays collapsed as the turn streams on', () => {
    const editCall = event({ id: 'e1', seq: 1, type: 'tool.call', payload: { name: 'Edit', callId: 'c1', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } } });
    const { rerender } = render(<ChatTrace events={[editCall]} />);
    expect(document.querySelector('[data-trace-edit]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit, src/a.ts' }));
    expect(document.querySelector('[data-trace-edit]')).toBeNull();

    // A later event must not re-open a row the human closed.
    const later = event({ id: 'e9', seq: 2, type: 'assistant.text', payload: { text: 'Now the next file.' } });
    rerender(<ChatTrace events={[editCall, later]} />);
    expect(document.querySelector('[data-trace-edit]')).toBeNull();
  });
});

describe('the V2 collapsed turn summary', () => {
  it('names tool calls, duration and tokens', () => {
    render(<ChatTurnTrace trace={trace} ws="ws1" contextWindowTokens={1_000_000} />);
    expect(screen.getByText(/weaver did/)).toBeInTheDocument();
    expect(screen.getByText(/7 tool calls/)).toBeInTheDocument();
    expect(screen.getByText(/18\.4k tok/)).toBeInTheDocument();
  });

  it('omits a quantity the runtime never reported rather than printing a zero', () => {
    const partial: RunTrace = {
      runId: 'r1', status: 'succeeded', agentId: 'weaver1', createdAt: '2026-09-13T09:00:00.000Z',
      startedAt: '2026-09-13T09:00:00.000Z', finishedAt: null, durationMs: null,
      toolCalls: 2, files: 0, errors: 0, texts: 1, events: 4, summary: null, model: null, usage: null,
    };
    render(<ChatTurnTrace trace={partial} ws="ws1" />);
    const line = document.querySelector('[data-chat-summary]') as HTMLElement;
    expect(line).toHaveTextContent('2 tool calls');
    expect(line.textContent).not.toMatch(/0 tok/);
  });

  it('remembers an opened turn across a remount, scoped to the workspace', () => {
    const first = render(<ChatTurnTrace trace={trace} ws="ws1" />);
    fireEvent.click(screen.getByRole('button', { name: 'What the weaver did' }));
    expect(screen.getByRole('button', { name: 'What the weaver did' })).toHaveAttribute('aria-expanded', 'true');
    first.unmount();

    render(<ChatTurnTrace trace={trace} ws="ws1" />);
    expect(screen.getByRole('button', { name: 'What the weaver did' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the live trace reveal (VS-433)', () => {
  const baseline = [
    event({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Read the first file.' } }),
    event({ id: 'e2', seq: 2, type: 'tool.call', payload: { name: 'Read', callId: 'c1', target: 'src/a.ts' } }),
  ];
  const arrival = event({ id: 'e3', seq: 3, type: 'assistant.text', payload: { text: 'Now the second file.' } });
  const narrations = (): HTMLElement[] => Array.from(document.querySelectorAll('[data-trace-narration]'));

  it('reveals a line that arrives while watching as a prefix, then the whole text', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ChatTrace events={baseline} reveal />);
    expect(narrations()[0]).toHaveTextContent('Read the first file.');

    rerender(<ChatTrace events={[...baseline, arrival]} reveal />);
    expect(narrations()).toHaveLength(2);
    expect(narrations()[1]).toBeTruthy();
    expect(narrations()[1]!.textContent).toBe('');

    act(() => { vi.advanceTimersByTime(80); });
    const mid = narrations()[1]!.textContent ?? '';
    expect(mid.length).toBeGreaterThan(0);
    expect('Now the second file.'.startsWith(mid)).toBe(true);

    act(() => { vi.advanceTimersByTime(500); });
    expect(narrations()[1]).toHaveTextContent('Now the second file.');
  });

  it('extends a growing line without restarting it', () => {
    vi.useFakeTimers();
    const base = [event({ id: 't1', seq: 1, type: 'tool.call', payload: { name: 'Read', callId: 'c1', target: 'src/a.ts' } })];
    const first = event({ id: 't2', seq: 2, type: 'assistant.text', payload: { text: 'Checking' } });
    const more = event({ id: 't3', seq: 3, type: 'assistant.text', payload: { text: ' the file' } });
    const { rerender } = render(<ChatTrace events={base} reveal />);

    rerender(<ChatTrace events={[...base, first]} reveal />);
    act(() => { vi.advanceTimersByTime(64); });
    const early = narrations()[0]!.textContent ?? '';
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan('Checking'.length);

    rerender(<ChatTrace events={[...base, first, more]} reveal />);
    const grown = narrations()[0]!.textContent ?? '';
    expect('Checking the file'.startsWith(grown)).toBe(true);
    expect(grown.length).toBeGreaterThanOrEqual(early.length);

    act(() => { vi.advanceTimersByTime(500); });
    expect(narrations()[0]).toHaveTextContent('Checking the file');
  });

  it('leaves lines present at mount whole', () => {
    vi.useFakeTimers();
    render(<ChatTrace events={baseline} reveal />);
    expect(narrations()[0]).toHaveTextContent('Read the first file.');
  });

  it('never animates the trace of a past turn', () => {
    state.events = [narration];
    render(<ChatTurnTrace trace={trace} ws="ws1" />);
    fireEvent.click(screen.getByRole('button', { name: 'What the weaver did' }));
    expect(document.querySelector('[data-trace-narration]')).toHaveTextContent('Reading the file first.');
  });

  it('renders a newly arrived line whole under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);

    const { rerender } = render(<ChatTrace events={baseline} reveal />);
    rerender(<ChatTrace events={[...baseline, arrival]} reveal />);
    expect(narrations()[1]).toHaveTextContent('Now the second file.');
  });
});
