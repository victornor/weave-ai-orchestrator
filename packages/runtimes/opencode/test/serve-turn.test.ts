import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, RuntimePartial } from '@weave-ai/runtime-sdk';
import { interruptedTurn } from '@weave-ai/runtime-sdk';
import { adapter } from '../src/adapter.js';

// VS-595: a turn driven through `opencode serve`. A fake `opencode` on PATH replays recorded server
// events (fixtures/serve-*.jsonl); nothing here launches the real CLI.
const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const path = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

interface Opts { fixture: string; cut?: number; hang?: boolean; mode?: 'auto' | 'restricted'; session?: string; interrupt?: boolean }
async function turn(o: Opts) {
  const bin = tmp('ac-bin-'); const cwd = tmp('ac-cwd-'); const configHome = tmp('ac-cfg-'); const logDir = tmp('ac-log-');
  const log = join(logDir, 'requests.log');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'opencode'), `#!/bin/sh\nexec ${process.execPath} ${path('./fake-opencode.mjs')} "$@"\n`);
  chmodSync(join(bin, 'opencode'), 0o755);
  const input = {
    runId: 'r', turnEpoch: 1, cwd, worktree: null, session: { policy: 'reuse', ref: o.session ? { sessionId: o.session } : null, isFirstTurn: !o.session },
    systemPrompt: { text: '', mode: 'skip' }, prompt: 'list files', mcpServers: {},
    env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_FIXTURE: path(`../fixtures/${o.fixture}.jsonl`), FAKE_LOG: log, ...(o.cut ? { FAKE_CUT: String(o.cut) } : {}), ...(o.hang ? { FAKE_HANG: '1' } : {}) },
    options: {}, limits: { timeoutMs: 30_000 }, permission: { mode: o.mode ?? 'auto' }, model: 'mock/m', configHome,
  } as never;
  const requests = (): string[] => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  // VS-660: the interrupt case is driven through the shared harness — the adapter-level path, with
  // the turn stopped and the partials recorded before the cut kept.
  if (o.interrupt) {
    const { result, recorded } = await interruptedTurn(adapter, input, { until: (r) => r.partials.length > 0, timeoutMs: 10_000 });
    return { result, events: recorded.events, partials: recorded.partials, requests: requests() };
  }
  const events: RuntimeEvent[] = []; const partials: RuntimePartial[] = [];
  const result = await adapter.runTurn(input, { onSpawn() {}, onEvent: (e) => events.push(e), onRaw() {}, onPartial: (x) => partials.push(x) });
  return { result, events, partials, requests: requests() };
}

describe('opencode serve turn', () => {
  it('runs a whole turn: partials, the tool call at its start, the result, and a clean ending', async () => {
    const { result, events, partials, requests } = await turn({ fixture: 'serve-turn-tool' });
    expect(result.error).toBeUndefined();
    expect(result.finalText).toBe('Done.');
    expect(result.session).toEqual({ sessionId: 'ses_fake_new' });
    expect(partials.map((x) => x.text).join('')).toBe('Let me check the directory.Done.');
    const types = events.map((e) => e.type);
    expect(types.indexOf('tool.call')).toBeGreaterThan(-1);
    expect(types.indexOf('tool.call')).toBeLessThan(types.indexOf('tool.result'));
    expect(types.at(-1)).toBe('turn.completed');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const prompt = requests.find((r) => r.startsWith('POST /session/ses_fake_new/prompt_async'))!;
    expect(JSON.parse(prompt.split(' ').slice(2).join(' '))).toMatchObject({ model: { providerID: 'mock', modelID: 'm' }, parts: [{ type: 'text', text: 'list files' }] });
    expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 7, basis: 'per_turn' });
  });

  it('resumes the given session instead of creating one', async () => {
    const { result, requests } = await turn({ fixture: 'serve-turn-tool', session: 'ses_prior' });
    expect(requests.some((r) => r.startsWith('POST /session '))).toBe(false);
    expect(requests.some((r) => r.startsWith('POST /session/ses_prior/prompt_async'))).toBe(true);
    expect(result.session).toEqual({ sessionId: 'ses_prior' });
    expect(result.error).toBeUndefined();
  });

  it('approves a permission ask in auto mode and rejects it in restricted mode', async () => {
    const auto = await turn({ fixture: 'serve-permission', cut: 14 });
    expect(auto.requests.find((r) => r.includes('/permissions/per_'))).toMatch(/"response":"once"/);
    const restricted = await turn({ fixture: 'serve-permission', cut: 14, mode: 'restricted' });
    expect(restricted.requests.find((r) => r.includes('/permissions/per_'))).toMatch(/"response":"reject"/);
  });

  it('reports a stream that ends after a tool-calls step as incomplete_turn (VS-573)', async () => {
    // Lines 1-19 end right after the first step's `finish: tool-calls`; the server then goes away.
    const { result } = await turn({ fixture: 'serve-turn-tool', cut: 19 });
    expect(result.error).toMatchObject({ code: 'incomplete_turn', family: 'transient_upstream' });
  });

  it('cancels mid-stream: aborts the session, stops the turn, and keeps the partials recorded before the cut', async () => {
    const { result, requests, partials } = await turn({ fixture: 'serve-turn-tool', cut: 12, hang: true, interrupt: true });
    expect(requests.some((r) => /^POST \/session\/ses_fake_new\/abort/.test(r))).toBe(true);
    expect(result.error).toBeDefined();
    expect(partials.length).toBeGreaterThan(0);
  });
});
