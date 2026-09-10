import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RunEvent } from '@agent-conductor/shared';
import { groupConsecutiveTools, reportUiStatus, runEventsToTranscript } from '../lib/transcript';
import type { TranscriptBlock } from '../lib/transcript';
import { Transcript } from '../components/Transcript';
import { Markdown } from '../components/Markdown';
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
});

function toolBlock(id: string, name: string): TranscriptBlock {
  return { id, type: 'tool', tool: name, target: id, durationMs: null, adds: null, dels: null, diff: null };
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
    expect(screen.getByText('src/theme/tokens.ts')).toBeInTheDocument();
    expect(screen.getByText(/phase: implementing/)).toBeInTheDocument();
    expect(screen.getByText('asked you a question · waiting 2m')).toBeInTheDocument();
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
    expect(screen.getByText('src/theme/tokens.ts')).toBeInTheDocument();
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
    const m = qrMatrix('otpauth://totp/AgentConductor:operator?secret=JBSWY3DPEHPK3PXP&issuer=AgentConductor');
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
