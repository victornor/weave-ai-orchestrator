import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RunEvent } from '@weave-ai/shared';
import { groupConsecutiveTools, reportUiStatus, runEventsToTranscript, targetBaseName } from '../lib/transcript';
import type { TranscriptBlock } from '../lib/transcript';
import { Transcript } from '../components/Transcript';
import { SplitHunk, UnifiedHunk } from '../components/DiffHunks';
import { Markdown } from '../components/Markdown';
import { markdownToHtml } from '../lib/markdown';
import { qrMatrix } from '../lib/qr';

function ev(over: Partial<RunEvent> & Pick<RunEvent, 'type'>): RunEvent {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    runId: 'run1',
    seq: over.seq ?? 0,
    ts: over.ts ?? '2026-09-01T09:00:00.000Z',
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

  // The adapters key the call id as `id`, not `callId` — correlating on `callId` alone left every
  // tool permanently pending with no result.
  it('merges a Claude-shaped tool result into its call and carries the result body', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'e1', type: 'tool.call', payload: { id: 'toolu_1', name: 'Read', input: { file_path: 'src/theme/tokens.ts' } } }),
      ev({ id: 'e2', type: 'tool.result', payload: { id: 'toolu_1', name: 'Read', isError: false, content: 'export const tokens = {}' } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'tool', tool: 'Read', target: 'src/theme/tokens.ts',
      diff: 'export const tokens = {}', error: false, pending: false,
    });
  });

  it('leaves a call with no result pending', () => {
    const blocks = runEventsToTranscript([ev({ id: 'e1', type: 'tool.call', payload: { id: 'toolu_1', name: 'Bash', input: { command: 'pnpm test' } } })]);
    expect(blocks[0]).toMatchObject({ type: 'tool', tool: 'Bash', target: 'pnpm test', pending: true });
  });

  it('marks a cut-off call not completed and adds a run-interrupted line when the run ended interrupted (VS-657)', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'e1', type: 'tool.call', payload: { id: 't1', name: 'Bash', input: { command: 'pnpm test' } } }),
      ev({ id: 'e2', type: 'tool.call', payload: { id: 't2', name: 'Read', input: { file_path: 'a.ts' } } }),
      ev({ id: 'e3', type: 'tool.result', payload: { id: 't2', isError: true, content: 'nope' } }),
      ev({ id: 'e4', type: 'run.finalized', payload: { status: 'interrupted' } }),
    ]);
    const cut = blocks.find((b) => b.type === 'tool' && b.tool === 'Bash');
    const failed = blocks.find((b) => b.type === 'tool' && b.tool === 'Read');
    expect(cut).toMatchObject({ type: 'tool', interrupted: true, pending: false });
    expect(failed).toMatchObject({ type: 'tool', error: true });
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'status', text: 'run interrupted', status: 'stalled' }));
  });

  it('leaves pending calls alone when the run succeeded (VS-657)', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'e1', type: 'tool.call', payload: { id: 't1', name: 'Bash', input: { command: 'pnpm test' } } }),
      ev({ id: 'e2', type: 'run.finalized', payload: { status: 'succeeded' } }),
    ]);
    expect(blocks[0]).toMatchObject({ type: 'tool', pending: true });
    expect(blocks.some((b) => b.type === 'status')).toBe(false);
  });

  it('marks an errored result and a denied call', () => {
    const [errored] = runEventsToTranscript([
      ev({ id: 'e1', type: 'tool.call', payload: { id: 't1', name: 'Bash' } }),
      ev({ id: 'e2', type: 'tool.result', payload: { id: 't1', isError: true, content: 'exit 1' } }),
    ]);
    expect(errored).toMatchObject({ error: true, denied: false, diff: 'exit 1' });

    const [denied] = runEventsToTranscript([
      ev({ id: 'e3', type: 'tool.call', payload: { id: 't2', name: 'Write' } }),
      ev({ id: 'e4', type: 'tool.denied', payload: { id: 't2', reason: 'not permitted' } }),
    ]);
    expect(denied).toMatchObject({ error: true, denied: true, diff: 'not permitted' });
  });

  // VS-205: Claude (and Gemini, Cursor) send `command.executed` on top of tool.call/tool.result
  // for every shell call, without the command text — rendered on its own it used to be a bare "$"
  // row (Transcript.tsx renders `type: 'command'` as "$" + `block.command`, which was always
  // empty for these). The payloads below are the exact shapes
  // `packages/runtimes/claude/test/events.test.ts` pins for the real recorded
  // `packages/runtimes/claude/fixtures/turn-tool-structured.jsonl` (its `Bash` "echo pong" call,
  // lines 6-7) — see that test for the stream-json round trip.
  it('folds a real Claude command.executed into its tool.call/tool.result row instead of a bare "$" row (VS-205)', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'e1', type: 'tool.call', payload: { id: 'toolu_01CDEhHFYnKmzdtoUb7kxquE', name: 'Bash', input: { command: 'echo pong', description: 'Run echo pong command' } } }),
      ev({ id: 'e2', type: 'tool.result', payload: { id: 'toolu_01CDEhHFYnKmzdtoUb7kxquE', name: 'Bash', isError: false, content: 'pong' } }),
      ev({ id: 'e3', type: 'command.executed', payload: { toolUseId: 'toolu_01CDEhHFYnKmzdtoUb7kxquE', tool: 'Bash', stdout: 'pong', stderr: '', isError: false } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'tool', tool: 'Bash', target: 'echo pong', diff: 'pong', error: false });
  });

  it('drops an orphan command.executed with no command or output as genuinely contentless (VS-205)', () => {
    const blocks = runEventsToTranscript([ev({ id: 'e1', type: 'command.executed', payload: { toolUseId: 'unseen', tool: 'Bash', isError: false } })]);
    expect(blocks).toHaveLength(0);
  });

  it('still renders an orphan command.executed that carries a command or output', () => {
    const blocks = runEventsToTranscript([ev({ id: 'e1', type: 'command.executed', payload: { command: 'pnpm vitest', exitCode: 1, stdout: '38/41 passed' } })]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'command', command: 'pnpm vitest', exitCode: 1, output: '38/41 passed' });
  });

  it('still shows a result whose call is absent', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'e1', type: 'tool.result', payload: { id: 'orphan', name: 'Grep', content: '3 matches' } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'tool', tool: 'Grep', diff: '3 matches', pending: false });
  });

  it('emits phase and status lines', () => {
    const blocks = runEventsToTranscript([
      ev({ type: 'run.phase.timing', payload: { phase: 'implementing', durationMs: 252000, tokens: 18400 } }),
      ev({ type: 'user_input.requested', payload: { summary: 'asked you a question' } }),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['phase', 'status']);
  });

  it('renders a runtime todo list as a working todo update, not a needs-you plan', () => {
    const [todo] = runEventsToTranscript([
      ev({ type: 'plan.proposed', payload: { id: 't1', items: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] } }),
    ]);
    expect(todo).toMatchObject({ type: 'status', status: 'working', text: 'updated the todo list · 2 items' });

    const [plan] = runEventsToTranscript([ev({ type: 'plan.proposed', payload: { title: 'Dark mode' } })]);
    expect(plan).toMatchObject({ type: 'status', status: 'needs-you', text: 'proposed a plan' });
  });

  const REPORT = {
    state: 'working',
    summary: 'Opened the PR for VS-147.',
    tickets: [{ id: 'VS-147', status: 'in_review' }],
    nextAction: { owner: 'human', what: 'Review the PR' },
    knowledge: { recorded: false, reason: 'mid-task; nothing durable to record yet' },
    uncommittedWork: false,
  } as const;
  const FENCED_REPORT = `\`\`\`json\n${JSON.stringify(REPORT, null, 2)}\n\`\`\``;

  it('replaces a trailing fenced report with a report block', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 't', type: 'assistant.text', payload: { text: "I'll add a token layer first." } }),
      ev({ id: 'c', type: 'tool.call', payload: { id: 'c1', name: 'Read', input: { file_path: 'src/theme/tokens.ts' } } }),
      ev({ id: 'r', type: 'assistant.text', payload: { text: FENCED_REPORT } }),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool', 'report']);
    expect(blocks[0]).toMatchObject({ type: 'text', text: "I'll add a token layer first." });
    expect(blocks[2]).toMatchObject({ type: 'report', report: REPORT, text: FENCED_REPORT });
  });

  it('treats consecutive prose-plus-report as one report block, not a split', () => {
    const mixed = `I'll open the PR.\n\n${FENCED_REPORT}`;
    const blocks = runEventsToTranscript([
      ev({ id: 't', type: 'assistant.text', payload: { text: mixed } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'report', report: REPORT, text: mixed });
  });

  it('still detects the report when a later event follows the last text block', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'r', type: 'assistant.text', payload: { text: FENCED_REPORT } }),
      ev({ id: 'so', type: 'tool.call', payload: { id: 'so1', name: 'StructuredOutput' } }),
      ev({ id: 'done', type: 'turn.completed', payload: { durationMs: 1200, tokens: 400 } }),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['report', 'tool', 'phase']);
    expect(blocks[0]).toMatchObject({ type: 'report', report: { state: 'working', summary: REPORT.summary } });
  });

  it('leaves ordinary trailing assistant text as a text block', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 't', type: 'assistant.text', payload: { text: 'The PR is up. Waiting on review.' } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'The PR is up. Waiting on review.' });
  });

  it('does not treat thinking text that happens to look like a report as the report', () => {
    const blocks = runEventsToTranscript([
      ev({ id: 'th', type: 'assistant.thinking', payload: { text: FENCED_REPORT } }),
      ev({ id: 't', type: 'assistant.text', payload: { text: 'Done.' } }),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text']);
    expect(blocks[0]).toMatchObject({ thinking: true, text: FENCED_REPORT });
    expect(blocks[1]).toMatchObject({ type: 'text', text: 'Done.' });
  });

  // Payload shapes below are copied field-for-field from `packages/runtimes/claude/src/events.ts`
  // (`tool.call`'s `input: b['input']`, the raw Claude tool_use block) and
  // `packages/runtimes/opencode/src/events.ts` (`tool.call`'s `input: st?.['input']`) — not
  // invented. Neither runtime's `tool.result`/`file.changed` carries this data (VS-324 design.md),
  // so it must come from `tool.call`.
  describe('edit payload extraction (VS-324)', () => {
    it('extracts a Claude Edit call as a single-edit payload', () => {
      const [block] = runEventsToTranscript([
        ev({ id: 'e1', type: 'tool.call', payload: { id: 'toolu_1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;', replace_all: false } } }),
      ]);
      expect(block).toMatchObject({
        type: 'tool', tool: 'Edit', target: 'src/a.ts',
        editPayload: { kind: 'edit', edits: [{ oldText: 'const x = 1;', newText: 'const x = 2;' }] },
      });
    });

    it('extracts a Claude MultiEdit call as one edit per array entry, in order', () => {
      const [block] = runEventsToTranscript([
        ev({
          id: 'e1', type: 'tool.call',
          payload: {
            id: 'toolu_2', name: 'MultiEdit',
            input: {
              file_path: 'src/b.ts',
              edits: [
                { old_string: 'one', new_string: 'ONE' },
                { old_string: 'two', new_string: 'TWO' },
              ],
            },
          },
        }),
      ]);
      expect(block).toMatchObject({
        type: 'tool', tool: 'MultiEdit', target: 'src/b.ts',
        editPayload: { kind: 'edit', edits: [{ oldText: 'one', newText: 'ONE' }, { oldText: 'two', newText: 'TWO' }] },
      });
    });

    it('extracts a Claude Write call as its written content', () => {
      const [block] = runEventsToTranscript([
        ev({ id: 'e1', type: 'tool.call', payload: { id: 'toolu_3', name: 'Write', input: { file_path: 'src/c.ts', content: 'export const c = 3;\n' } } }),
      ]);
      expect(block).toMatchObject({
        type: 'tool', tool: 'Write', target: 'src/c.ts',
        editPayload: { kind: 'write', content: 'export const c = 3;\n' },
      });
    });

    it('extracts an opencode edit call, including its filePath as the target', () => {
      const [block] = runEventsToTranscript([
        ev({ id: 'e1', type: 'tool.call', payload: { id: 'call_1', name: 'edit', input: { filePath: 'src/d.ts', oldString: 'old', newString: 'new' } } }),
      ]);
      expect(block).toMatchObject({
        type: 'tool', tool: 'edit', target: 'src/d.ts',
        editPayload: { kind: 'edit', edits: [{ oldText: 'old', newText: 'new' }] },
      });
    });

    it('extracts an opencode write call', () => {
      const [block] = runEventsToTranscript([
        ev({ id: 'e1', type: 'tool.call', payload: { id: 'call_2', name: 'write', input: { filePath: 'src/e.ts', content: 'export const e = 5;' } } }),
      ]);
      expect(block).toMatchObject({
        type: 'tool', tool: 'write', target: 'src/e.ts',
        editPayload: { kind: 'write', content: 'export const e = 5;' },
      });
    });

    it('leaves an unrecognised tool with no edit payload, falling back to the compact row', () => {
      const [block] = runEventsToTranscript([
        ev({ id: 'e1', type: 'tool.call', payload: { id: 'c1', name: 'Read', input: { file_path: 'src/f.ts' } } }),
      ]);
      expect(block).toMatchObject({ type: 'tool', tool: 'Read', target: 'src/f.ts' });
      expect((block as { editPayload?: unknown }).editPayload).toBeNull();
    });

    it('leaves a recognised edit tool with no edit payload when its fields are missing', () => {
      const [block] = runEventsToTranscript([
        ev({ id: 'e1', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/g.ts' } } }),
      ]);
      expect((block as { editPayload?: unknown }).editPayload).toBeNull();
    });
  });

  describe('thinking block duration (VS-324)', () => {
    it('derives a duration from the gap to the next event', () => {
      const blocks = runEventsToTranscript([
        ev({ id: 'th', type: 'assistant.thinking', payload: { text: 'Weighing the options.' }, ts: '2026-09-01T09:00:00.000Z' }),
        ev({ id: 't', type: 'assistant.text', payload: { text: 'Done.' }, ts: '2026-09-01T09:00:01.100Z' }),
      ]);
      expect(blocks[0]).toMatchObject({ thinking: true, thinkingDurationMs: 1100 });
    });

    it('has no duration when it is the last event', () => {
      const blocks = runEventsToTranscript([
        ev({ id: 'th', type: 'assistant.thinking', payload: { text: 'Weighing the options.' } }),
      ]);
      expect(blocks[0]).toMatchObject({ thinking: true, thinkingDurationMs: null });
    });
  });
});

function toolBlock(id: string, name: string): TranscriptBlock {
  return { id, type: 'tool', tool: name, target: id, targetPath: null, durationMs: null, adds: null, dels: null, diff: null };
}

describe('groupConsecutiveTools', () => {
  it('folds ten consecutive Reads into one group of 10', () => {
    const rows = groupConsecutiveTools(Array.from({ length: 10 }, (_, i) => toolBlock(`r${i}`, 'Read')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'tools', tool: 'Read' });
    expect(rows[0]?.type === 'tools' && rows[0].calls).toHaveLength(10);
  });

  it('keeps Read, Glob, Read as three groups', () => {
    const rows = groupConsecutiveTools([toolBlock('a', 'Read'), toolBlock('b', 'Glob'), toolBlock('c', 'Read')]);
    expect(rows.map((r) => (r.type === 'tools' ? r.tool : r.block.type === 'tool' ? r.block.tool : r.block.type))).toEqual([
      'Read',
      'Glob',
      'Read',
    ]);
    expect(rows.every((r) => r.type === 'single')).toBe(true);
  });

  it('does not group a single Read', () => {
    const rows = groupConsecutiveTools([toolBlock('a', 'Read')]);
    expect(rows).toEqual([{ type: 'single', block: toolBlock('a', 'Read') }]);
  });

  it('splits two Reads when a text or phase line sits between them', () => {
    const text: TranscriptBlock = { id: 't', type: 'text', text: 'next' };
    const phase: TranscriptBlock = { id: 'p', type: 'phase', phase: 'implementing', durationMs: null, tokens: null };
    const viaText = groupConsecutiveTools([toolBlock('a', 'Read'), text, toolBlock('b', 'Read')]);
    const viaPhase = groupConsecutiveTools([toolBlock('a', 'Read'), phase, toolBlock('b', 'Read')]);
    expect(viaText.map((r) => r.type)).toEqual(['single', 'single', 'single']);
    expect(viaPhase.map((r) => r.type)).toEqual(['single', 'single', 'single']);
  });
});

describe('reportUiStatus', () => {
  it('maps report states that have no matching UiStatus spelling', () => {
    expect(reportUiStatus('needs_decision')).toBe('needs-you');
    expect(reportUiStatus('paused')).toBe('stalled');
  });

  it('keeps the shared spellings', () => {
    expect(reportUiStatus('working')).toBe('working');
    expect(reportUiStatus('blocked')).toBe('blocked');
    expect(reportUiStatus('done')).toBe('done');
    expect(reportUiStatus('failed')).toBe('failed');
    expect(reportUiStatus('idle')).toBe('idle');
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
    expect(screen.getByText('tokens.ts')).toBeInTheDocument();
    expect(screen.getByText(/phase: implementing/)).toBeInTheDocument();
    expect(screen.getByText('asked you a question · waiting 2m')).toBeInTheDocument();
  });

  // VS-319: a live text block used to render as literal `<p className="whitespace-pre-wrap">`,
  // so markdown characters showed up raw. It now renders through the same `Markdown` component a
  // finished message uses.
  it('renders a live text block through markdown, matching a finished message', () => {
    render(
      <Transcript
        events={[
          ev({ id: 'a', type: 'assistant.text', payload: { text: '**Inbox:**\n\n1. First\n2. Second\n\nRun `pnpm test` now.' } }),
        ]}
      />,
    );
    expect(screen.getByText('Inbox:').tagName).toBe('STRONG');
    expect(screen.getByText('pnpm test').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['First', 'Second']);
  });

  // VS-324: a thinking block now collapses to one line by default; expanding it renders the same
  // markdown VS-319 already produced when thinking always rendered expanded.
  it('collapses a thinking block by default and expands to its dimmed, italic markdown', () => {
    render(<Transcript events={[ev({ id: 'a', type: 'assistant.thinking', payload: { text: 'Checking `foo.ts` next.' } })]} />);
    expect(screen.queryByText('foo.ts')).not.toBeInTheDocument();
    expect(screen.getByText('Thought')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Thought'));
    const code = screen.getByText('foo.ts');
    expect(code.tagName).toBe('CODE');
    expect(code.closest('.italic')).not.toBeNull();
  });

  it('shows a thinking block\'s duration on the collapsed line when it is derivable', () => {
    render(
      <Transcript
        events={[
          ev({ id: 'a', type: 'assistant.thinking', payload: { text: 'Weighing options.' }, ts: '2026-09-01T09:00:00.000Z' }),
          ev({ id: 'b', type: 'assistant.text', payload: { text: 'Done.' }, ts: '2026-09-01T09:00:01.100Z' }),
        ]}
      />,
    );
    expect(screen.getByText('Thought · 1.1s')).toBeInTheDocument();
  });

  it('shows a thinking block collapsed with no duration figure when none is derivable', () => {
    render(<Transcript events={[ev({ id: 'a', type: 'assistant.thinking', payload: { text: 'Weighing options.' } })]} />);
    expect(screen.getByText('Thought')).toBeInTheDocument();
    expect(screen.queryByText(/Thought ·/)).not.toBeInTheDocument();
  });

  it('renders a block with an unclosed bold marker without crashing, and settles once it closes', () => {
    const { rerender } = render(<Transcript events={[ev({ id: 'a', type: 'assistant.text', payload: { text: 'Adding **bold' } })]} />);
    expect(screen.getByText(/Adding \*\*bold/)).toBeInTheDocument();

    rerender(<Transcript events={[ev({ id: 'a', type: 'assistant.text', payload: { text: 'Adding **bold** now.' } })]} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders an unfinished list item without crashing, and settles once the list continues', () => {
    const { rerender } = render(<Transcript events={[ev({ id: 'a', type: 'assistant.text', payload: { text: '1. Ste' } })]} />);
    expect(screen.getByText('Ste')).toBeInTheDocument();

    rerender(<Transcript events={[ev({ id: 'a', type: 'assistant.text', payload: { text: '1. Step one\n2. Step two' } })]} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Step one', 'Step two']);
  });

  it('renders an unclosed fenced code block without crashing, and settles once it closes', () => {
    const { rerender } = render(<Transcript events={[ev({ id: 'a', type: 'assistant.text', payload: { text: '```\nstill going' } })]} />);
    expect(screen.getByText('still going')).toBeInTheDocument();

    rerender(<Transcript events={[ev({ id: 'a', type: 'assistant.text', payload: { text: '```\nstill going\n```\ndone.' } })]} />);
    expect(screen.getByText('done.')).toBeInTheDocument();
    expect(screen.getByText('still going').tagName).toBe('CODE');
  });

  it('renders untrusted trace text as inert, never as executed markup', () => {
    render(
      <Transcript
        events={[ev({ id: 'a', type: 'assistant.text', payload: { text: 'See <img src=x onerror="window.__pwned = true">' } })]}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(screen.getByText(/<img src=x onerror=/)).toBeInTheDocument();
  });

  const REPORT = {
    state: 'working' as const,
    summary: 'Opened the PR for VS-147.',
    tickets: [{ id: 'VS-147', status: 'in_review' }],
    nextAction: { owner: 'human' as const, what: 'Review the PR' },
    knowledge: { recorded: false, reason: 'mid-task; nothing durable to record yet' },
    uncommittedWork: false,
  };
  const FENCED_REPORT = `\`\`\`json\n${JSON.stringify(REPORT, null, 2)}\n\`\`\``;

  it('renders a trailing report collapsed to its summary, and expands to the JSON', () => {
    render(
      <Transcript
        events={[
          ev({ id: 'a', type: 'assistant.text', payload: { text: "I'll open the PR." } }),
          ev({ id: 'b', type: 'tool.call', payload: { callId: 'c', name: 'Read', input: { file_path: 'src/theme/tokens.ts' } } }),
          ev({ id: 'r', type: 'assistant.text', payload: { text: FENCED_REPORT } }),
        ]}
      />,
    );
    expect(screen.getByText("I'll open the PR.")).toBeInTheDocument();
    expect(screen.getByText('tokens.ts')).toBeInTheDocument();
    expect(screen.getByText('Opened the PR for VS-147.')).toBeInTheDocument();
    expect(screen.queryByText(/"uncommittedWork"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"nextAction"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Turn report: Opened the PR for VS-147.' }));
    expect(screen.getByText(/"uncommittedWork"/)).toBeInTheDocument();
    expect(screen.getByText(/"nextAction"/)).toBeInTheDocument();
  });

  it('collapses ten consecutive Reads into Read ×10 and expands to each path', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      ev({ id: `r${i}`, type: 'tool.call', payload: { id: `c${i}`, name: 'Read', input: { file_path: `f${i}.ts` } } }),
    );
    render(<Transcript events={events} />);
    expect(screen.getByText('Read ×10')).toBeInTheDocument();
    expect(screen.queryByText('f0.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('f9.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Read, 10 calls' }));
    expect(screen.getByText('f0.ts')).toBeInTheDocument();
    expect(screen.getByText('f9.ts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Read, 10 calls' }));
    expect(screen.queryByText('f0.ts')).not.toBeInTheDocument();
  });

  it('keeps a mixed Read, Glob, Read as three groups', () => {
    render(
      <Transcript
        events={[
          ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Read', input: { file_path: 'a.ts' } } }),
          ev({ id: 'b', type: 'tool.call', payload: { id: 'c2', name: 'Glob', input: { pattern: '**/*.ts' } } }),
          ev({ id: 'c', type: 'tool.call', payload: { id: 'c3', name: 'Read', input: { file_path: 'b.ts' } } }),
        ]}
      />,
    );
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('**/*.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
  });

  it('does not count a single Read', () => {
    render(
      <Transcript
        events={[ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Read', input: { file_path: 'solo.ts' } } })]}
      />,
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.queryByText(/Read ×/)).not.toBeInTheDocument();
    expect(screen.getByText('solo.ts')).toBeInTheDocument();
  });

  describe('file target display (VS-437)', () => {
    it('takes the last segment of a path', () => {
      expect(targetBaseName('/home/user/project/src/MEMORY.md')).toBe('MEMORY.md');
      expect(targetBaseName('src/theme/tokens.ts')).toBe('tokens.ts');
      expect(targetBaseName('MEMORY.md')).toBe('MEMORY.md');
    });

    it('drops a trailing separator and handles Windows separators', () => {
      expect(targetBaseName('/home/user/dir/')).toBe('dir');
      expect(targetBaseName('C:\\Users\\me\\file.ts')).toBe('file.ts');
    });

    it('falls back to the input when nothing remains', () => {
      expect(targetBaseName('')).toBe('');
      expect(targetBaseName('/')).toBe('/');
    });

    it('shows only the file name for an absolute-path Edit, with the whole path in the title', () => {
      render(
        <Transcript
          events={[ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: '/home/user/project/src/a.ts', old_string: 'x', new_string: 'y' } } })]}
        />,
      );
      expect(screen.getByText('a.ts')).toHaveAttribute('title', '/home/user/project/src/a.ts');
      expect(screen.queryByText('/home/user/project/src/a.ts')).not.toBeInTheDocument();
    });

    it('shows only the file name for a Read and a Write too', () => {
      render(
        <Transcript
          events={[
            ev({ id: 'r', type: 'tool.call', payload: { id: 'c1', name: 'Read', input: { file_path: '/abs/dir/readme.md' } } }),
            ev({ id: 'w', type: 'tool.call', payload: { id: 'c2', name: 'Write', input: { filePath: '/abs/dir/notes.txt', content: 'hi' } } }),
          ]}
        />,
      );
      expect(screen.getByText('readme.md')).toHaveAttribute('title', '/abs/dir/readme.md');
      expect(screen.getByText('notes.txt')).toHaveAttribute('title', '/abs/dir/notes.txt');
    });

    it('leaves a shell command target exactly as it was', () => {
      render(<Transcript events={[ev({ id: 'b', type: 'tool.call', payload: { id: 'c1', name: 'Bash', input: { command: 'cd /abs/dir && ls' } } })]} />);
      expect(screen.getByText('cd /abs/dir && ls')).not.toHaveAttribute('title');
    });
  });

  describe('edit and written-file rendering (VS-324)', () => {
    // VS-324 review: captain's ask was to see the diff itself, matching the opencode screenshots
    // where diffs are already on screen — so an edit/write row renders expanded with no click.
    it('renders a Claude Edit call as a diff with old/new line numbers and add/remove text, with no click', () => {
      render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } } }),
          ]}
        />,
      );
      // Both the split and unified layouts are mounted at once (CSS container query chooses which
      // shows), so a line's text appears in the DOM twice.
      expect(screen.getAllByText('const x = 1;').length).toBeGreaterThan(0);
      expect(screen.getAllByText('const x = 2;').length).toBeGreaterThan(0);
    });

    it('renders an opencode edit call the same way, with no click', () => {
      render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'edit', input: { filePath: 'src/b.ts', oldString: 'old text', newString: 'new text' } } }),
          ]}
        />,
      );
      expect(screen.getAllByText('old text').length).toBeGreaterThan(0);
      expect(screen.getAllByText('new text').length).toBeGreaterThan(0);
    });

    it('renders one hunk per edit for a MultiEdit call, in order, with no click', () => {
      render(
        <Transcript
          events={[
            ev({
              id: 'a', type: 'tool.call',
              payload: {
                id: 'c1', name: 'MultiEdit',
                input: { file_path: 'src/c.ts', edits: [{ old_string: 'one', new_string: 'ONE' }, { old_string: 'two', new_string: 'TWO' }] },
              },
            }),
          ]}
        />,
      );
      expect(screen.getAllByText('one').length).toBeGreaterThan(0);
      expect(screen.getAllByText('ONE').length).toBeGreaterThan(0);
      expect(screen.getAllByText('two').length).toBeGreaterThan(0);
      expect(screen.getAllByText('TWO').length).toBeGreaterThan(0);
    });

    it('renders a Write call as numbered written content, with no click', () => {
      render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Write', input: { file_path: 'src/d.ts', content: 'line one\nline two' } } }),
          ]}
        />,
      );
      expect(screen.getByText('line one')).toBeInTheDocument();
      expect(screen.getByText('line two')).toBeInTheDocument();
    });

    it('still collapses an edit row when its header is activated, despite opening expanded', () => {
      render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } } }),
          ]}
        />,
      );
      expect(screen.getAllByText('const x = 1;').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByText('a.ts'));
      expect(screen.queryByText('const x = 1;')).not.toBeInTheDocument();
    });

    it('collapses a long written file behind a "Show more" control, windowed at 40 lines', () => {
      const content = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
      render(
        <Transcript
          events={[ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Write', input: { file_path: 'src/big.ts', content } } })]}
        />,
      );
      expect(screen.getByText('line 0')).toBeInTheDocument();
      expect(screen.getByText('line 39')).toBeInTheDocument();
      expect(screen.queryByText('line 40')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show 20 more lines' }));
      expect(screen.getByText('line 40')).toBeInTheDocument();
      expect(screen.getByText('line 59')).toBeInTheDocument();
    });

    it('collapses a long edit hunk behind its own "Show more" control, windowed at 40 lines', () => {
      // Entirely disjoint old/new text: the LCS finds nothing in common, so the hunk is 120 lines
      // (60 removed + 60 added), not 60 — the window caps the first 40 of those, all removes.
      const oldText = Array.from({ length: 60 }, (_, i) => `old ${i}`).join('\n');
      const newText = Array.from({ length: 60 }, (_, i) => `new ${i}`).join('\n');
      render(
        <Transcript
          events={[ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/big-edit.ts', old_string: oldText, new_string: newText } } })]}
        />,
      );
      expect(screen.getAllByText('old 0').length).toBeGreaterThan(0);
      expect(screen.getAllByText('old 39').length).toBeGreaterThan(0);
      expect(screen.queryByText('old 40')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show 80 more lines' }));
      expect(screen.getAllByText('old 40').length).toBeGreaterThan(0);
      expect(screen.getAllByText('old 59').length).toBeGreaterThan(0);
    });

    it('does not fold consecutive edits into a counted group — each shows its own diff', () => {
      render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/one.ts', old_string: 'one old', new_string: 'one new' } } }),
            ev({ id: 'b', type: 'tool.call', payload: { id: 'c2', name: 'Edit', input: { file_path: 'src/two.ts', old_string: 'two old', new_string: 'two new' } } }),
          ]}
        />,
      );
      expect(screen.queryByText(/Edit ×/)).not.toBeInTheDocument();
      expect(screen.getAllByText('one old').length).toBeGreaterThan(0);
      expect(screen.getAllByText('one new').length).toBeGreaterThan(0);
      expect(screen.getAllByText('two old').length).toBeGreaterThan(0);
      expect(screen.getAllByText('two new').length).toBeGreaterThan(0);
    });

    it('does not recompute an unchanged edit block\'s hunks when later events append', async () => {
      const render1 = await import('@weave-ai/render');
      const spy = vi.spyOn(render1, 'diffHunksForEdits');
      spy.mockClear();
      const editEvent = ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } } });
      const { rerender } = render(<Transcript events={[editEvent]} />);
      expect(spy).toHaveBeenCalledTimes(1);

      rerender(<Transcript events={[editEvent, ev({ id: 'b', type: 'assistant.text', payload: { text: 'more' } })]} />);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('falls back to the compact row for a tool this capability does not recognise', () => {
      render(
        <Transcript
          events={[ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Read', input: { file_path: 'src/e.ts' } } })]}
        />,
      );
      expect(screen.getByText('e.ts')).toBeInTheDocument();
      // Nothing expands: no button wraps the row (no diff, no editPayload).
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('falls back to the compact row for a recognised edit tool missing its fields', () => {
      render(
        <Transcript
          events={[ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/f.ts' } } })]}
        />,
      );
      expect(screen.getByText('f.ts')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('never interprets edit or written-file text as HTML', () => {
      const payload = 'See <img src=x onerror="window.__pwned = true">';
      render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/g.ts', old_string: 'old', new_string: payload } } }),
            ev({ id: 'b', type: 'tool.call', payload: { id: 'c2', name: 'Write', input: { file_path: 'src/h.ts', content: payload } } }),
          ]}
        />,
      );
      expect(document.querySelector('img')).toBeNull();
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
      expect(screen.getAllByText(/<img src=x onerror=/).length).toBeGreaterThan(0);
    });

    // jsdom does not evaluate CSS container queries, so which of these two DOM trees is actually
    // visible cannot be asserted here — that is a visual check. What this test pins is the mechanism
    // itself: both layouts are mounted, gated by opposing `@min-[48rem]:` container-query classes at
    // the width chosen for two readable code columns (VS-344) rather than a JS-measured width, so a
    // real browser's layout — not a script — decides which one shows.
    it('renders both the split and unified diff layouts, gated by opposing container-query classes', () => {
      render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/i.ts', old_string: 'old', new_string: 'new' } } }),
          ]}
        />,
      );
      const splitWrapper = document.querySelector('.hidden.\\@min-\\[48rem\\]\\:block');
      const unifiedWrapper = document.querySelector('.\\@min-\\[48rem\\]\\:hidden');
      expect(splitWrapper).not.toBeNull();
      expect(unifiedWrapper).not.toBeNull();
      expect(splitWrapper?.querySelector('.grid-cols-2')).not.toBeNull();
      expect(unifiedWrapper?.querySelector('.grid-cols-2')).toBeNull();
      // The too-early 32rem threshold the ticket reports is gone.
      expect(document.querySelector('.\\@min-\\[32rem\\]\\:block')).toBeNull();
    });

    // VS-344: the overlap was a split column whose `whitespace-pre` line painted over the divider.
    // Each column now shrinks (min-w-0) and its code span wraps, so a long line stays inside it.
    it('keeps each split column inside itself and wraps its long lines', () => {
      const { container } = render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/i.ts', old_string: 'old', new_string: 'new' } } }),
          ]}
        />,
      );
      const grid = container.querySelector('.grid-cols-2');
      expect(grid).not.toBeNull();
      const columns = Array.from(grid!.children) as HTMLElement[];
      expect(columns).toHaveLength(2);
      for (const col of columns) {
        expect(col.className).toContain('min-w-0');
        expect(col.className).toContain('overflow-hidden');
      }
      const codeSpans = grid!.querySelectorAll('div.flex > span:last-child');
      expect(codeSpans.length).toBeGreaterThan(0);
      for (const span of codeSpans) {
        expect(span.className).toContain('min-w-0');
        expect(span.className).toContain('flex-1');
        expect(span.className).toContain('whitespace-pre-wrap');
        expect(span.className).toContain('break-words');
      }
    });

    // A line with no break opportunity is the case wrapping has to handle, not the easy one. The
    // grid stays `grid-cols-2` (Tailwind's `minmax(0, 1fr)` tracks, which cannot be widened by
    // content) and both columns carry `min-w-0`, which is what lets the wrapping code span win over
    // the content's intrinsic width in a real browser. jsdom cannot measure the result.
    it('does not let a very long single-token line widen the split grid', () => {
      const { container } = render(
        <Transcript
          events={[
            ev({ id: 'a', type: 'tool.call', payload: { id: 'c1', name: 'Edit', input: { file_path: 'src/i.ts', old_string: 'a'.repeat(400), new_string: 'b'.repeat(400) } } }),
          ]}
        />,
      );
      const grid = container.querySelector('.grid-cols-2');
      expect(grid).not.toBeNull();
      for (const col of Array.from(grid!.children) as HTMLElement[]) {
        expect(col.className).toContain('min-w-0');
      }
    });

    it('wraps a unified hunk by default and keeps horizontal scrolling when asked not to', () => {
      const h = {
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@',
        lines: [{ kind: 'context' as const, oldLine: 1, newLine: 1, text: 'keep' }],
      };
      const hl = (text: string): string => text;
      const { container, rerender } = render(<UnifiedHunk hunk={h} highlight={hl} />);
      const row = container.querySelector('div.flex')!;
      expect(row.className).toContain('whitespace-pre-wrap');
      expect(row.className).toContain('break-words');
      expect(row.querySelector('span:last-child')!.className).toContain('min-w-0');

      rerender(<UnifiedHunk hunk={h} highlight={hl} wrap={false} />);
      const scrollingRow = container.querySelector('div.flex')!;
      expect(scrollingRow.className).toContain('whitespace-pre');
      expect(scrollingRow.className).not.toContain('whitespace-pre-wrap');
      expect(scrollingRow.querySelector('span:last-child')!.className).not.toContain('flex-1');
    });

    // VS-419: a diff line's tint is the diff's own green/red, never the status palette — Mono makes
    // `--status-done` grey, so `bg-done` would render an addition as context.
    it('tints added and removed lines with the diff tokens, not the status tokens', () => {
      const h = {
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@',
        lines: [
          { kind: 'remove' as const, oldLine: 1, newLine: null, text: 'old' },
          { kind: 'add' as const, oldLine: null, newLine: 1, text: 'new' },
          { kind: 'context' as const, oldLine: 2, newLine: 2, text: 'keep' },
        ],
      };
      const hl = (text: string): string => text;
      const { container } = render(<UnifiedHunk hunk={h} highlight={hl} />);
      const rows = Array.from(container.querySelectorAll('div.flex')) as HTMLElement[];
      expect(rows).toHaveLength(3);
      expect(rows[0]!.className).toContain('bg-diff-remove-bg');
      expect(rows[0]!.className).not.toContain('bg-failed');
      expect(rows[1]!.className).toContain('bg-diff-add-bg');
      expect(rows[1]!.className).not.toContain('bg-done');
      expect(rows[2]!.className).not.toContain('bg-diff-add-bg');
      expect(rows[2]!.className).not.toContain('bg-diff-remove-bg');
    });

    it('tints the side-by-side columns with the diff tokens too', () => {
      const h = {
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '@@ -1 +1 @@',
        lines: [
          { kind: 'remove' as const, oldLine: 1, newLine: null, text: 'old' },
          { kind: 'add' as const, oldLine: null, newLine: 1, text: 'new' },
        ],
      };
      const hl = (text: string): string => text;
      const { container } = render(<SplitHunk hunk={h} highlight={hl} />);
      const rowClass = (text: string): string =>
        (Array.from(container.querySelectorAll('div.flex')) as HTMLElement[]).find((r) => r.textContent?.includes(text))!.className;
      expect(rowClass('old')).toContain('bg-diff-remove-bg');
      expect(rowClass('old')).not.toContain('bg-failed');
      expect(rowClass('new')).toContain('bg-diff-add-bg');
      expect(rowClass('new')).not.toContain('bg-done');
    });
  });
});

describe('markdown', () => {
  it('escapes html and renders the subset', () => {
    const html = markdownToHtml('# Title\n\n- one\n- two\n\n`code` and <script>alert(1)</script>');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<code class="ac-copy" data-copy="code">code</code>');
    expect(html).not.toContain('<script>');
  });

  it('reflows the lines of a paragraph by default', () => {
    expect(markdownToHtml('first line\nsecond line')).toBe('<p>first line second line</p>');
  });

  it('keeps single newlines as hard breaks under breaks', () => {
    expect(markdownToHtml('first line\nsecond line', { breaks: true })).toBe('<p>first line<br />second line</p>');
  });

  it('collapses a run of blank lines into one paragraph gap under breaks', () => {
    expect(markdownToHtml('one\n\n\n\ntwo', { breaks: true })).toBe('<p>one</p>\n<p>two</p>');
  });

  it('leaves lists, fences and escaping alone under breaks', () => {
    const html = markdownToHtml('- one\n- two\n\n```\na\nb <b>\n```', { breaks: true });
    expect(html).toContain('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(html).toContain('<pre><code>a\nb &lt;b&gt;</code></pre>');
    expect(html).not.toContain('<br />');
  });

  it('still renders an inline span that spans a hard break', () => {
    expect(markdownToHtml('**bold\nacross**', { breaks: true })).toBe('<p><strong>bold<br />across</strong></p>');
  });

  // ---------- VS-139: copy source and the inline-code order-dependency fix ----------

  it('attaches the exact fenced-block source, with no leading or trailing blank line', () => {
    const html = markdownToHtml('```\nfirst  \nsecond\n\nfourth\n```');
    expect(html).toContain('<div class="ac-codeblock">');
    expect(html).toContain('<pre><code>first  \nsecond\n\nfourth</code></pre>');
    expect(html).toContain('data-copy="first  \nsecond\n\nfourth"');
    expect(html).toContain('<button type="button" class="ac-copy-btn"');
  });

  it('renders an empty fenced block without a copy source that would confuse an empty copy for a failure', () => {
    const html = markdownToHtml('```\n```');
    expect(html).toContain('data-copy=""');
  });

  it('gives an inline code span the same data-copy value as its visible text, entity for entity', () => {
    const html = markdownToHtml('run `a && b "q" <x>` now');
    expect(html).toContain('<code class="ac-copy" data-copy="a &amp;&amp; b &quot;q&quot; &lt;x&gt;">a &amp;&amp; b &quot;q&quot; &lt;x&gt;</code>');
  });

  it('does not add or drop a trailing newline relative to the fenced source', () => {
    expect(markdownToHtml('```\nline one\nline two\n```')).toContain('data-copy="line one\nline two"');
  });

  it('shows inline code containing markdown-special characters as literal text, not reinterpreted', () => {
    const html = markdownToHtml('`**not bold**` and `[[not-a-doclink]]`');
    expect(html).toContain('<code class="ac-copy" data-copy="**not bold**">**not bold**</code>');
    expect(html).toContain('<code class="ac-copy" data-copy="[[not-a-doclink]]">[[not-a-doclink]]</code>');
    expect(html).not.toContain('<strong>not bold</strong>');
    expect(html).not.toContain('ac-doclink');
  });

  it('still applies bold and doc-links outside of code spans in the same line', () => {
    const html = markdownToHtml('**bold** then `code` then [[a-doc]]');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code class="ac-copy" data-copy="code">code</code>');
    expect(html).toContain('class="ac-doclink"');
  });

  it('renders a GFM pipe table with inline markup in cells', () => {
    const html = markdownToHtml('| col | type |\n| --- | --- |\n| **id** | `string` |');
    expect(html).toContain('<div class="ac-table"><table>');
    expect(html).toContain('<th>col</th>');
    expect(html).toContain('<th>type</th>');
    expect(html).toContain('<td><strong>id</strong></td>');
    expect(html).toContain('<td><code class="ac-copy" data-copy="string">string</code></td>');
  });

  it('flushes an unclosed fence as a code block', () => {
    const html = markdownToHtml('intro\n\n```\nstill open');
    expect(html).toContain('<pre><code>still open</code></pre>');
    expect(html).toContain('<p>intro</p>');
  });
});

describe('Markdown copy control', () => {
  const setClipboard = (value: { writeText: (t: string) => Promise<void> } | undefined): void => {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies a fenced block\'s exact source when its button is used, and confirms visibly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<Markdown source={'```\nfoo  \nbar\n```'} />);
    const button = screen.getByRole('button', { name: 'Copy code' });
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('foo  \nbar');
    await waitFor(() => expect(button).toHaveAttribute('data-copy-state', 'copied'));
  });

  it('copies an inline code span\'s exact source when it is tapped', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<Markdown source="run `ls -la` now" />);
    fireEvent.click(screen.getByText('ls -la'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('ls -la');
  });

  it('does not copy when the tap is really the end of selecting the surrounding paragraph', () => {
    const writeText = vi.fn();
    setClipboard({ writeText });
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'run ls -la now' } as unknown as Selection);
    render(<Markdown source="run `ls -la` now" />);
    fireEvent.click(screen.getByText('ls -la'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says it cannot copy when the clipboard is unavailable, rather than doing nothing', () => {
    setClipboard(undefined);
    render(<Markdown source="run `ls -la` now" />);
    fireEvent.click(screen.getByText('ls -la'));
    expect(screen.getByText('ls -la')).toHaveAttribute('data-copy-state', 'unavailable');
  });

  it('shows a failed state, not a silent no-op, when the clipboard write is refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    setClipboard({ writeText });
    render(<Markdown source="run `ls -la` now" />);
    fireEvent.click(screen.getByText('ls -la'));
    await waitFor(() => expect(screen.getByText('ls -la')).toHaveAttribute('data-copy-state', 'failed'));
  });
});

describe('qr', () => {
  it('produces a square matrix with the three finder patterns', () => {
    const m = qrMatrix('otpauth://totp/Weave AI:operator?secret=JBSWY3DPEHPK3PXP&issuer=Weave AI');
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
