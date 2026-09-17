import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent, TurnHandle, TurnInput } from '@weave-ai/runtime-sdk';
import { runTmpDir } from '@weave-ai/runtime-sdk';
import { RUN_REPORT_JSON_SCHEMA, RunReportSchema } from '@weave-ai/shared';
import { adapter } from '../src/adapter.js';

const strictReport = {
  state: 'idle', summary: 'file final', tickets: [], nextAction: null,
  knowledge: { recorded: false, where: null, reason: 'Nothing durable' }, uncommittedWork: false,
};
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function input(scenario = 'success', ref: TurnInput['session']['ref'] = null, mode: TurnInput['permission']['mode'] = 'auto'): TurnInput {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-codex-'));
  dirs.push(dir);
  // Absolute interpreter plus a PATH containing only this fixture guarantees no real CLI runs.
  writeFileSync(join(dir, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ args, prompt, cwd: process.cwd(), home: process.env.CODEX_HOME }));
  if (process.env.SCENARIO === 'empty') return;
  emit({ type: 'thread.started', thread_id: args[1] === 'fork' ? 'forked-thread' : 'thread-1' });
  emit({ type: 'turn.started' });
  const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
  function checkSchema(node) {
    if (!node || typeof node !== 'object') return;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.includes('object')) {
      if (node.additionalProperties !== false) throw new Error('invalid_json_schema: additionalProperties must be false');
      const keys = Object.keys(node.properties || {});
      if (!Array.isArray(node.required) || node.required.length !== keys.length || keys.some((key) => !node.required.includes(key))) throw new Error('invalid_json_schema: every property must be required');
      for (const child of Object.values(node.properties || {})) checkSchema(child);
    }
    if (node.items) checkSchema(node.items);
  }
  try { checkSchema(schema); } catch (error) {
    emit({ type: 'turn.failed', error: { message: error.message } });
    process.exitCode = 1; return;
  }
  if (process.env.SCENARIO === 'hang') { setInterval(() => {}, 1000); return; }
  if (process.env.SCENARIO === 'failure') {
    emit({ type: 'turn.failed', error: { message: '401 Unauthorized' } });
    process.exitCode = 0; return;
  }
  const configPath = process.env.CODEX_HOME ? require('node:path').join(process.env.CODEX_HOME, 'config.toml') : '';
  const configText = configPath && fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const hasRunScopedMcp = args.some((arg) => arg.includes('mcp_servers.weave-ai.url=')) || configText.includes('[mcp_servers.weave-ai]');
  const mcpApprovalNever = args.includes('mcp_servers.weave-ai.default_tools_approval_mode="never"') || configText.includes('default_tools_approval_mode = "never"');
  const bypassApproval = args.includes('--dangerously-bypass-approvals-and-sandbox');
  // MCP approval is distinct from shell-command approval: a configured server
  // must explicitly opt out of per-tool approval for a headless worker.
  if (hasRunScopedMcp && !mcpApprovalNever && !bypassApproval) {
    emit({ type: 'turn.failed', error: { message: 'MCP tool call requires approval, but approval policy is never' } });
    process.exitCode = 1; return;
  }
  emit({ type: 'error', message: 'Reconnecting... 1/5' });
  emit({ type: 'item.completed', item: { id: 'tool-read', type: 'mcp_tool_call', server: 'weave-ai', tool: 'weave_ticket_get', status: 'completed', arguments: { id: 'VS-485' }, result: { ok: true, data: { id: 'VS-485' } } } });
  emit({ type: 'item.completed', item: { id: 'tool-write', type: 'mcp_tool_call', server: 'weave-ai', tool: 'weave_ticket_document_put', status: 'failed', arguments: { key: 'report' }, error: { code: 'CONFLICT', message: 'document revision conflict' } } });
  emit({ type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text: 'stream final' } });
  const output = args[args.indexOf('-o') + 1];
  fs.writeFileSync(output, ${JSON.stringify(JSON.stringify(strictReport))});
  emit({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 } });
});
`, { mode: 0o755 });
  return {
    runId: `codex-${dir.split('/').at(-1)}`, turnEpoch: 1, cwd: dir, worktree: null,
    session: { policy: 'per_ticket', ref, isFirstTurn: !ref }, systemPrompt: { text: '', mode: 'skip' },
    prompt: 'private prompt\nsecond line', outputSchema: RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>, mcpServers: {},
    env: { PATH: dir + delimiter, CAPTURE: join(dir, 'capture.json'), SCENARIO: scenario },
    configHome: dir, options: { model: 'test-model', contextWindowTokens: 1000000 }, limits: { timeoutMs: 5000 }, permission: { mode },
  };
}

const sink = (events: RuntimeEvent[] = []) => ({ onSpawn: () => undefined, onRaw: () => undefined, onEvent: (ev: RuntimeEvent) => events.push(ev) });
const turnCases = [
  { mode: 'auto' as const, ref: null },
  { mode: 'auto' as const, ref: { threadId: 'thread-1', usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } } },
  { mode: 'auto' as const, ref: { threadId: 'thread-1', fork: true, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } } },
  { mode: 'restricted' as const, ref: null },
  { mode: 'restricted' as const, ref: { threadId: 'thread-1', usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } } },
  { mode: 'restricted' as const, ref: { threadId: 'thread-1', fork: true, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } } },
];

describe('Codex turn against a fake CLI', () => {
  it.each(turnCases)('completes %s new/resumed/forked turns: %j', async ({ mode, ref }) => {
    const turn = input('success', ref, mode);
    writeFileSync(join(turn.cwd, 'config.toml'), 'model_provider = "custom"\n');
    turn.options['mcpViaConfigFile'] = true;
    turn.mcpServers = { 'weave-ai': { type: 'http', url: 'http://localhost/mcp/runs/run-1', headers: { Authorization: 'Bearer ticket-token' } } };
    const events: RuntimeEvent[] = [];
    const result = await adapter.runTurn(turn, sink(events));
    expect(result.error).toBeUndefined();
    expect(result.session).toEqual({ threadId: ref?.fork ? 'forked-thread' : 'thread-1', usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80 } });
    expect(events[0]?.type).toBe(ref && !ref.fork ? 'session.resumed' : 'session.started');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(events.filter((e) => e.type === 'tool.call').map((e) => e.payload['name'])).toEqual(['weave_ticket_get', 'weave_ticket_document_put']);
    expect(events.filter((e) => e.type === 'tool.result').map((e) => e.payload['isError'])).toEqual([false, true]);
    expect(result.finalText).toBe(JSON.stringify(strictReport));
    expect(result.structured).toEqual(strictReport);
    expect(RunReportSchema.safeParse(result.structured).success).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, basis: 'per_turn' });
    expect(result.model).toBe('test-model');
    const capture = JSON.parse(readFileSync(join(turn.cwd, 'capture.json'), 'utf8'));
    expect(capture.prompt).toBe(turn.prompt);
    expect(capture.args).not.toContain(turn.prompt);
    expect(capture.args).toContain('mcp_servers.weave-ai.default_tools_approval_mode="never"');
    expect(capture.args.join(' ')).toContain(mode === 'auto' ? 'workspace-write' : 'read-only');
    expect(capture.args.join(' ')).toContain('mcp_servers.weave-ai.url="http://localhost/mcp/runs/run-1"');
    expect(capture.args.join(' ')).not.toContain('ticket-token');
    expect(capture.cwd).toBe(turn.cwd);
    expect(capture.home).toBe(turn.configHome);
    expect(readFileSync(join(turn.cwd, 'config.toml'), 'utf8')).toBe('model_provider = "custom"\n');
    expect(existsSync(runTmpDir(turn.runId))).toBe(false);
  });

  it('keeps the configured MCP server callable for the weaver bypass posture', async () => {
    const turn = input();
    writeFileSync(join(turn.cwd, 'config.toml'), 'model_provider = "custom"\\n');
    turn.options['mcpViaConfigFile'] = true;
    turn.permission = { mode: 'bypass' };
    turn.mcpServers = { 'weave-ai': { type: 'http', url: 'http://localhost/mcp/runs/weaver', headers: { Authorization: 'Bearer weaver-token' } } };
    const events: RuntimeEvent[] = [];
    const result = await adapter.runTurn(turn, sink(events));
    expect(result.error).toBeUndefined();
    expect(events.filter((e) => e.type === 'tool.call').map((e) => e.payload['name'])).toEqual(['weave_ticket_get', 'weave_ticket_document_put']);
    const capture = JSON.parse(readFileSync(join(turn.cwd, 'capture.json'), 'utf8'));
    expect(capture.args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(capture.args).not.toContain('approval_policy="on-request"');
    expect(capture.args.join(' ')).toContain('mcp_servers.weave-ai.url="http://localhost/mcp/runs/weaver"');
    expect(capture.args.join(' ')).not.toContain('weaver-token');
  });

  it('classifies protocol failures even with a zero process exit', async () => {
    expect((await adapter.runTurn(input('failure'), sink())).error?.family).toBe('auth');
  });

  it('rejects an empty successful process instead of silently completing the run', async () => {
    expect((await adapter.runTurn(input('empty'), sink())).error?.message).toContain('without completing');
  });

  it('times out and cleans scratch files', async () => {
    const turn = input('hang');
    turn.limits.timeoutMs = 200;
    const result = await adapter.runTurn(turn, sink());
    expect(result.timedOut).toBe(true);
    expect(result.error).toBeDefined();
    expect(existsSync(runTmpDir(turn.runId))).toBe(false);
  });

  it('cancels the running process through its handle', async () => {
    let handle: TurnHandle | undefined;
    const result = await adapter.runTurn(input('hang'), {
      ...sink(), onEvent: (ev) => { if (ev.type === 'turn.started') void handle!.cancel('kill'); },
    }, (h) => { handle = h; });
    expect(handle?.send).toBeUndefined();
    expect(result.signal).toBe('SIGKILL');
    expect(result.error).toBeDefined();
  });
});


it('initializes MCP config once and overrides the endpoint on subsequent turns', async () => {
  const first = input();
  first.options['mcpViaConfigFile'] = true;
  first.mcpServers = { ac: { type: 'http', url: 'http://first/mcp', headers: { Authorization: 'Bearer first-token' } } };
  expect((await adapter.runTurn(first, sink())).error).toBeUndefined();
    const config = readFileSync(join(first.cwd, 'config.toml'), 'utf8');
    expect(config).toContain('http://first/mcp');
    expect(config).toContain('default_tools_approval_mode = "never"');
  expect(config).not.toContain('first-token');
  const next = input();
  next.configHome = first.configHome;
  next.options['mcpViaConfigFile'] = true;
  next.mcpServers = { ac: { type: 'http', url: 'http://second/mcp', headers: { Authorization: 'Bearer second-token' } } };
  expect((await adapter.runTurn(next, sink())).error).toBeUndefined();
  expect(readFileSync(join(first.cwd, 'config.toml'), 'utf8')).toBe(config);
  expect(JSON.parse(readFileSync(join(next.cwd, 'capture.json'), 'utf8')).args).toContain('mcp_servers.ac.url="http://second/mcp"');
});


it.each([
  { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' } }, required: [] },
  { type: 'object', additionalProperties: false, properties: { child: { type: 'object', properties: {} } }, required: ['child'] },
])('the fake provider rejects invalid schemas, including nested objects: %j', async (schema) => {
  const turn = input();
  turn.outputSchema = schema;
  const result = await adapter.runTurn(turn, sink());
  expect(result.error?.message).toContain('invalid_json_schema');
  expect(result.exitCode).toBe(1);
});

it('charges only this turn when resuming an existing session', async () => {
  const turn = input('success', { threadId: 'thread-1', usage: { inputTokens: 60, outputTokens: 5, cachedInputTokens: 40 } });
  const events: RuntimeEvent[] = [];
  const result = await adapter.runTurn(turn, sink(events));
  expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 15, cachedInputTokens: 40, basis: 'per_turn' });
  expect(result.session).toMatchObject({ usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80 } });
  expect(events.find(e => e.type === 'usage.delta')?.payload).toEqual(result.usage);
});

it('recovers the baseline for a session created before usage was saved in its reference', async () => {
  const turn = input('success', { threadId: 'thread-1' });
  const dir = join(turn.cwd, 'sessions', '2026', '09', '16');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rollout-thread-1.jsonl'), JSON.stringify({ payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 60, output_tokens: 5, cached_input_tokens: 40 } } } }));
  const result = await adapter.runTurn(turn, sink());
  expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 15, cachedInputTokens: 40, basis: 'per_turn' });
});
