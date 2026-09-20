import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChildEvent, ChildPartial } from '../protocol.js';
import { startMockProvider, textChunks, toolCallChunks, type MockProvider } from '../testkit/mockProvider.js';
import { loadReplConfig } from './config.js';
import { Renderer, renderEvent, summarizeCall } from './events.js';
import { runReplTurn, type ReplState } from './run.js';
import { newSessionId, sessionPath } from './sessions.js';

const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload });
const part = (kind: ChildPartial['kind'], partId: string, text: string): ChildPartial => ({ kind, partId, text });

describe('Renderer (pure)', () => {
  it('streams text and thinking, and does not print the completed event a second time', () => {
    const r = new Renderer({ color: false });
    let s = r.partial(part('thinking', 'm:k', 'hmm '));
    s += r.partial(part('thinking', 'm:k', 'ok'));
    s += r.partial(part('text', 'm:t', 'Hello'));
    s += r.partial(part('text', 'm:t', ' world'));
    s += r.event(ev('assistant.thinking', { partId: 'm:k', text: 'hmm ok' }));
    s += r.event(ev('assistant.text', { partId: 'm:t', text: 'Hello world' }));
    s += r.finish();
    expect(s).toBe('∴ hmm ok\nHello world\n');
  });

  it('prints a completed text that was never streamed, and dims thinking when colour is on', () => {
    const plain = new Renderer({ color: false }).event(ev('assistant.text', { partId: 'x', text: 'whole' }));
    expect(plain).toBe('whole\n');
    const coloured = new Renderer({ color: true }).partial(part('thinking', 'k', 'quiet'));
    expect(coloured).toContain('\x1b[2m');
  });

  it('shows a tool call as one line and hides the argument stream', () => {
    const r = new Renderer({ color: false });
    expect(r.partial(part('tool_input', 'c1', '{"command":"ls"}'))).toBe('');
    expect(r.event(ev('tool.call', { id: 'c1', name: 'bash', input: { command: 'ls -la' } }))).toBe('▸ bash  ls -la\n');
    expect(summarizeCall('grep', { pattern: 'foo', path: 'src' })).toBe('foo  in src');
    expect(summarizeCall('read', { path: '/a/b.ts' })).toBe('/a/b.ts');
  });

  it('streams command output indented, and does not repeat it in the result; a non-zero exit is shown', () => {
    const r = new Renderer({ color: false });
    let s = r.event(ev('tool.call', { id: 'c1', name: 'bash', input: { command: 'make' } }));
    s += r.partial(part('tool_output', 'c1:out', 'line one\nline t'));
    s += r.partial(part('tool_output', 'c1:out', 'wo\n'));
    s += r.event(ev('command.executed', { id: 'c1', command: 'make', exitCode: 2, output: 'line one\nline two\n' }));
    s += r.event(ev('tool.result', { id: 'c1', partId: 'c1:out', name: 'bash', status: 'completed', isError: false, content: 'line one\nline two\nexit code: 2' }));
    expect(s).toBe('▸ bash  make\n  line one\n  line two\n  exit 2\n');
  });

  it('prints non-streamed command output as a tail, and errors and denials plainly', () => {
    const r = new Renderer({ color: false });
    const many = Array.from({ length: 20 }, (_, i) => `row ${i}`).join('\n');
    const s = r.event(ev('command.executed', { id: 'c', command: 'x', exitCode: 0, output: many }));
    expect(s).toContain('… 5 earlier lines');
    expect(s).toContain('row 19');
    expect(s).not.toContain('row 4\n');
    expect(r.event(ev('tool.denied', { id: 'c', name: 'bash', reason: 'sudo is refused' }))).toBe('  denied: sudo is refused\n');
    expect(r.event(ev('error', { message: 'boom' }))).toBe('error: boom\n');
    expect(r.event(ev('tool.result', { id: 'z', name: 'read', isError: true, content: 'Error: no such file' }))).toBe('  Error: no such file\n');
  });

  it('never lets a secret through', () => {
    const r = new Renderer({ color: false, secrets: ['sk-topsecret-1234'] });
    expect(r.partial(part('text', 't', 'the key is sk-topsecret-1234 ok'))).toBe('the key is [redacted] ok');
    expect(r.event(ev('error', { message: 'bad key sk-topsecret-1234' }))).not.toContain('sk-topsecret');
  });

  it('renders a todo list, compaction and an interrupted turn', () => {
    const r = new Renderer({ color: false });
    expect(r.event(ev('plan.proposed', { items: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }] }))).toBe('  ☑ a\n  ◐ b\n  ☐ c\n');
    expect(r.event(ev('session.compaction.completed', { ok: true, tokensBefore: 900, tokensAfter: 200 }))).toBe('compacted: 900 → 200 tokens\n');
    expect(r.event(ev('turn.completed', { interrupted: true }))).toBe('interrupted\n');
    expect(renderEvent(ev('tool.call', { name: 'skill', input: { name: 'lint' } }), { color: false })).toEqual(['▸ skill  lint']);
  });
});

describe('Renderer on the real loop\'s events', () => {
  let dir: string; let mock: MockProvider;
  beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'wa-repl-ev-')); mkdirSync(join(dir, 'proj')); mock = await startMockProvider(); });
  afterEach(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

  it('shows an edit as a diff and a bash call as its command with its output, captured from a real turn', async () => {
    const cwd = join(dir, 'proj');
    writeFileSync(join(cwd, 'a.txt'), 'alpha\nbeta\ngamma\n');
    mock.script(
      { chunks: toolCallChunks([{ id: 'r1', name: 'read', args: JSON.stringify({ path: 'a.txt' }) }]) },
      { chunks: toolCallChunks([{ id: 'e1', name: 'edit', args: JSON.stringify({ path: 'a.txt', old_string: 'beta', new_string: 'BETA' }) }]) },
      { chunks: toolCallChunks([{ id: 'b1', name: 'bash', args: JSON.stringify({ command: 'echo from-bash' }) }]) },
      { chunks: textChunks('all done') },
    );
    const cfg = loadReplConfig({ flags: { provider: 'mock', baseUrl: mock.baseUrl, model: 'm' }, env: { WEAVE_LLM_MOCK_KEY: 'k1234567' }, cwd, home: dir });
    const id = newSessionId();
    const state: ReplState = { providerId: 'mock', model: 'm', permission: 'auto', effort: null, params: {}, sessionId: id, sessionPath: sessionPath(join(dir, 'home'), id) };
    const r = new Renderer({ color: false });
    let text = '';
    const events: ChildEvent[] = [];
    const res = await runReplTurn(state, cfg, 'go', { cwd, homeDir: join(dir, 'home'), env: { PATH: process.env['PATH'] ?? '', HOME: dir, WEAVE_LLM_MOCK_KEY: 'k1234567' } }, { emit: (e) => { events.push(e); text += r.event(e); }, partial: (p) => { text += r.partial(p); }, log: () => undefined }, new AbortController().signal);
    text += r.finish();
    expect(res.exitCode).toBe(0);
    expect(text).toContain('▸ read  a.txt');
    expect(text).toContain('▸ edit  a.txt');
    expect(text).toMatch(/modified .*a\.txt \+1 -1/);
    expect(text).toMatch(/^\s+-\s*beta$/m);
    expect(text).toMatch(/^\s+\+\s*BETA$/m);
    expect(text).toContain('▸ bash  echo from-bash');
    expect(text).toContain('from-bash');
    expect(text.trimEnd().endsWith('all done')).toBe(true);
    // the edit's own tool.result (which repeats the diff) is not printed a second time
    expect(text.match(/BETA/g)).toHaveLength(1);
    expect(events.some((e) => e.type === 'usage.delta')).toBe(true);
    expect(text).not.toContain('usage');
  });
});
