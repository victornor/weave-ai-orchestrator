/**
 * VS-349: the V2 chat trace — narration italic in a dimmer ink, a tool row naming the tool and its
 * argument, result lines indented two spaces under their call, and the collapsed summary line that
 * omits a quantity the runtime never reported.
 */
import { render, screen } from '@testing-library/react';
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

beforeEach(() => {
  state.events = [];
});

describe('the V2 chat trace', () => {
  it('renders narration italic in a dimmer ink', () => {
    render(<ChatTrace events={[narration, call, result]} />);
    const el = document.querySelector('[data-trace-narration]') as HTMLElement;
    expect(el.className).toMatch(/italic/);
    expect(el.className).toMatch(/text-text-4/);
    expect(el).toHaveTextContent('Reading the file first.');
  });

  it('names the tool and its argument, with the result indented two spaces under the call', () => {
    render(<ChatTrace events={[narration, call, result]} />);
    const tool = document.querySelector('[data-trace-tool]') as HTMLElement;
    expect(tool).toHaveTextContent('Read');
    expect(tool).toHaveTextContent('src/x.ts');

    const res = document.querySelector('[data-trace-result]') as HTMLElement;
    expect(res.style.paddingLeft).toBe('2ch');
    // The result follows its call in document order.
    expect(tool.compareDocumentPosition(res) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the V2 collapsed turn summary', () => {
  it('names tool calls, duration and tokens', () => {
    const trace: RunTrace = {
      runId: 'r1', status: 'succeeded', agentId: 'weaver1', createdAt: '2026-09-13T09:00:00.000Z',
      startedAt: '2026-09-13T09:00:00.000Z', finishedAt: '2026-09-13T09:00:34.000Z', durationMs: 34_000,
      toolCalls: 7, files: 0, errors: 0, texts: 2, events: 10, summary: null, model: 'sonnet',
      usage: { inputTokens: 10_000, outputTokens: 8_400, cachedInputTokens: 0, basis: 'reported' },
    };
    render(<ChatTurnTrace trace={trace} contextWindowTokens={1_000_000} />);
    expect(screen.getByText(/weaver did/)).toBeInTheDocument();
    expect(screen.getByText(/7 tool calls/)).toBeInTheDocument();
    expect(screen.getByText(/18\.4k tok/)).toBeInTheDocument();
  });

  it('omits a quantity the runtime never reported rather than printing a zero', () => {
    const trace: RunTrace = {
      runId: 'r1', status: 'succeeded', agentId: 'weaver1', createdAt: '2026-09-13T09:00:00.000Z',
      startedAt: '2026-09-13T09:00:00.000Z', finishedAt: null, durationMs: null,
      toolCalls: 2, files: 0, errors: 0, texts: 1, events: 4, summary: null, model: null, usage: null,
    };
    render(<ChatTurnTrace trace={trace} />);
    const line = document.querySelector('[data-chat-summary]') as HTMLElement;
    expect(line).toHaveTextContent('2 tool calls');
    expect(line.textContent).not.toMatch(/0 tok/);
  });
});
