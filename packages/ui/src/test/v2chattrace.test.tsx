/**
 * VS-349 / VS-370: the V2 chat trace — narration italic in a dimmer ink, a tool row naming the tool
 * and its argument, result lines behind their call, grouped same-name calls collapsed to one counted
 * line, output bounded in a scroll container, and the collapsed turn summary that omits a quantity
 * the runtime never reported.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('shows an edit call collapsed by default, opening to the shared diff hunks', () => {
    render(
      <ChatTrace
        events={[event({ id: 'e1', seq: 1, type: 'tool.call', payload: { name: 'Edit', callId: 'c1', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } } })]}
      />,
    );
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(document.querySelector('[data-trace-edit]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit, src/a.ts' }));
    const body = document.querySelector('[data-trace-edit]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body).toHaveClass('ac-scroll');
    expect(body).toHaveTextContent('const x = 1;');
    expect(body).toHaveTextContent('const x = 2;');
  });

  it('shows a write call collapsed by default, opening to the written file', () => {
    render(
      <ChatTrace
        events={[event({ id: 'e1', seq: 1, type: 'tool.call', payload: { name: 'Write', callId: 'c1', input: { file_path: 'src/b.ts', content: 'export const b = 1;\nexport const c = 2;' } } })]}
      />,
    );
    expect(screen.getByText('src/b.ts')).toBeInTheDocument();
    expect(document.querySelector('[data-trace-edit]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Write, src/b.ts' }));
    expect(document.querySelector('[data-trace-edit]') as HTMLElement).toHaveTextContent('export const b = 1;');
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
