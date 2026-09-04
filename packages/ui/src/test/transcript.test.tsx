import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RunEvent } from '@openconductor/shared';
import { runEventsToTranscript } from '../lib/transcript';
import { Transcript } from '../components/Transcript';
import { markdownToHtml } from '../lib/markdown';
import { qrMatrix } from '../lib/qr';

function ev(over: Partial<RunEvent> & Pick<RunEvent, 'type'>): RunEvent {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    runId: 'run1',
    seq: over.seq ?? 0,
    ts: '2026-09-01T09:00:00.000Z',
    stream: 'stdout',
    level: 'info',
    payload: over.payload ?? {},
    type: over.type,
  };
}

describe('runEventsToTranscript', () => {
  it('merges consecutive assistant text into one block', () => {
    const blocks = runEventsToTranscript([
      ev({ type: 'assistant.text', payload: { text: 'I will add ' } }),
      ev({ type: 'assistant.text', payload: { text: 'a token layer.' } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'I will add a token layer.' });
  });

  it('merges a tool result into the call that opened it', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'e1', type: 'tool.call', payload: { callId: 'c1', name: 'Read', input: { file_path: 'src/theme/tokens.ts' } } }),
      ev({ id: 'e2', type: 'tool.result', payload: { callId: 'c1', durationMs: 400 } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'tool', tool: 'Read', target: 'src/theme/tokens.ts', durationMs: 400 });
  });

  it('emits phase and status lines', () => {
    const blocks = runEventsToTranscript([
      ev({ type: 'run.phase.timing', payload: { phase: 'implementing', durationMs: 252000, tokens: 18400 } }),
      ev({ type: 'user_input.requested', payload: { summary: 'asked you a question' } }),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['phase', 'status']);
  });
});

describe('Transcript', () => {
  it('renders the four line types', () => {
    render(
      <Transcript
        events={[
          ev({ id: 'a', type: 'assistant.text', payload: { text: "I'll add a token layer first." } }),
          ev({ id: 'b', type: 'tool.call', payload: { callId: 'c', name: 'Read', input: { file_path: 'src/theme/tokens.ts' } } }),
          ev({ id: 'c', type: 'tool.result', payload: { callId: 'c', durationMs: 400 } }),
          ev({ id: 'd', type: 'run.phase.timing', payload: { phase: 'implementing', durationMs: 252000, tokens: 18400 } }),
          ev({ id: 'e', type: 'user_input.requested', payload: { summary: 'asked you a question · waiting 2m' } }),
        ]}
      />,
    );
    expect(screen.getByText("I'll add a token layer first.")).toBeInTheDocument();
    expect(screen.getByText('src/theme/tokens.ts')).toBeInTheDocument();
    expect(screen.getByText(/phase: implementing/)).toBeInTheDocument();
    expect(screen.getByText('asked you a question · waiting 2m')).toBeInTheDocument();
  });
});

describe('markdown', () => {
  it('escapes html and renders the subset', () => {
    const html = markdownToHtml('# Title\n\n- one\n- two\n\n`code` and <script>alert(1)</script>');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<code>code</code>');
    expect(html).not.toContain('<script>');
  });
});

describe('qr', () => {
  it('produces a square matrix with the three finder patterns', () => {
    const m = qrMatrix('otpauth://totp/OpenConductor:operator?secret=JBSWY3DPEHPK3PXP&issuer=OpenConductor');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    for (const [r, c] of [
      [0, 0],
      [0, m.length - 7],
      [m.length - 7, 0],
    ] as const) {
      expect(m[r]![c]).toBe(true);
      expect(m[r + 1]![c + 1]).toBe(false);
      expect(m[r + 3]![c + 3]).toBe(true);
    }
  });
});
