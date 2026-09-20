#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAgentTurn, type LoopIO } from './loop.js';
import type { ChildEvent, ChildPartial, InitMessage } from './protocol.js';
import { SseParser } from './sse.js';

/**
 * The live check: one real turn through the real agent loop against a real endpoint, from a scratch
 * directory, keeping the raw bytes of every response. It is run by hand (`weave` owner or the weaver),
 * never from CI: the key comes from an environment variable and is never printed or written.
 */
export interface ConformanceOptions {
  baseUrl: string; model: string; keyEnv?: string; auth?: string; outDir: string;
  env?: Record<string, string | undefined>; fetch?: typeof fetch; log?: (line: string) => void;
}
export interface Check { name: string; ok: boolean; detail: string }
export interface ConformanceReport { ok: boolean; checks: Check[]; captures: string[]; elapsedMs: number; rssMb: number; finalText: string | null; error: string | null }

const PROMPT = 'Use the read tool to read the file hello.txt, then tell me in one short sentence what it says.';

function insideGitRepo(path: string): boolean {
  for (let p = resolve(path); ; p = dirname(p)) { if (existsSync(join(p, '.git'))) return true; if (dirname(p) === p) return false; }
}

export interface WireFacts { events: number; comments: number; done: boolean; finishChunks: number; usage: 'with_finish' | 'separate_empty_choices' | 'none'; reasoningFields: string[]; toolIdRepeats: boolean; models: string[]; toolNames: string[] }

/** What a captured response's bytes say about the provider's stream shape. */
export function inspectCapture(bytes: Buffer): WireFacts {
  const parser = new SseParser();
  const events = [...parser.feed(new Uint8Array(bytes)), ...parser.end()];
  const facts: WireFacts = { events: 0, comments: (bytes.toString('utf8').match(/^:/gm) ?? []).length, done: false, finishChunks: 0, usage: 'none', reasoningFields: [], toolIdRepeats: false, models: [], toolNames: [] };
  const reasoning = new Set<string>(); const models = new Set<string>(); const names = new Set<string>(); const idSeen = new Map<string, number>();
  for (const e of events) {
    if (e.data === '[DONE]') { facts.done = true; continue; }
    let c: Record<string, any>;
    try { c = JSON.parse(e.data); } catch { continue; }
    facts.events++;
    if (typeof c['model'] === 'string') models.add(c['model']);
    const choice = c['choices']?.[0];
    if (choice?.finish_reason) facts.finishChunks++;
    if (c['usage']) facts.usage = c['choices']?.length ? 'with_finish' : 'separate_empty_choices';
    const d = choice?.delta ?? {};
    for (const k of ['reasoning_content', 'reasoning', 'reasoning_details']) if (d[k]) reasoning.add(k);
    for (const tc of d.tool_calls ?? []) {
      if (tc.function?.name) names.add(tc.function.name);
      if (tc.id) idSeen.set(tc.id, (idSeen.get(tc.id) ?? 0) + 1);
    }
  }
  facts.reasoningFields = [...reasoning]; facts.models = [...models]; facts.toolNames = [...names];
  facts.toolIdRepeats = [...idSeen.values()].some((n) => n > 1);
  return facts;
}

export async function runConformance(o: ConformanceOptions): Promise<ConformanceReport> {
  const say = o.log ?? (() => undefined);
  const env = o.env ?? process.env;
  if (insideGitRepo(o.outDir)) throw new Error(`--out ${o.outDir} is inside a git repository; captures must live outside the repo`);
  mkdirSync(o.outDir, { recursive: true });
  const apiKey = o.keyEnv ? env[o.keyEnv] : undefined;
  if (o.keyEnv && !apiKey) throw new Error(`environment variable ${o.keyEnv} is not set`);

  const scratch = mkdtempSync(join(tmpdir(), 'weave-conformance-'));
  mkdirSync(join(scratch, 'wt'));
  writeFileSync(join(scratch, 'wt', 'hello.txt'), 'Hello from the conformance harness.\n');

  const captures: string[] = [];
  const raw = o.fetch ?? fetch;
  let n = 0;
  // Tee each response body to a file as it streams: the bytes on disk are exactly what the wire carried.
  const teeFetch: typeof fetch = async (input, init) => {
    const idx = ++n;
    const res = await raw(input, init);
    const reqFile = join(o.outDir, `request-${idx}.json`);
    writeFileSync(reqFile, String(init?.body ?? ''));
    if (!res.body) return res;
    const chunks: Buffer[] = [];
    const t = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) { chunks.push(Buffer.from(chunk)); ctl.enqueue(chunk); },
      flush() { const f = join(o.outDir, `response-${idx}.${res.ok ? 'sse' : 'txt'}`); writeFileSync(f, Buffer.concat(chunks)); captures.push(f); },
    });
    return new Response(res.body.pipeThrough(t), { status: res.status, statusText: res.statusText, headers: res.headers });
  };

  const events: ChildEvent[] = []; const partials: ChildPartial[] = [];
  const io: LoopIO = { emit: (e) => events.push(e), partial: (p) => partials.push(p), log: (l, m) => say(`  [${l}] ${m}`) };
  const init: InitMessage = {
    type: 'init', v: 1,
    run: { runId: 'conformance', turnEpoch: 1, cwd: scratch, worktree: { path: join(scratch, 'wt'), branch: 'conformance' }, limits: { timeoutMs: 300_000, maxTurns: 6 }, permission: { mode: 'auto' }, model: o.model, options: {}, spillDir: join(scratch, 'spill') },
    provider: { id: 'conformance', baseUrl: o.baseUrl, auth: o.auth ?? 'bearer', headers: {}, ...(apiKey ? { apiKey } : {}) },
    prompt: PROMPT, systemPrompt: { text: '', mode: 'skip' }, session: { path: join(scratch, 'session.jsonl'), id: 'conformance' }, mcpServers: {}, toolEnv: { PATH: env['PATH'] ?? '' },
  };
  const started = Date.now();
  say(`turn against ${o.baseUrl} model ${o.model}`);
  const result = await runAgentTurn(init, io, new AbortController().signal, { fetch: teeFetch });
  const elapsedMs = Date.now() - started;

  const facts = captures.filter((f) => f.endsWith('.sse')).map((f) => inspectCapture(readFileSync(f)));
  const first = facts[0];
  const call = events.find((e) => e.type === 'tool.call');
  const checks: Check[] = [
    { name: 'turn completed', ok: result.exitCode === 0, detail: result.error ? `${result.error.code} (${result.error.family}): ${result.error.message}` : `exit ${result.exitCode}` },
    { name: 'response streamed', ok: (first?.events ?? 0) > 1 && partials.length > 0, detail: `${first?.events ?? 0} chunks in the first response, ${partials.length} partials` },
    { name: 'tool call assembled', ok: call?.payload['name'] === 'read' && typeof call.payload['input'] === 'object', detail: call ? `${String(call.payload['name'])} ${JSON.stringify(call.payload['input'])}` : 'the model made no tool call' },
    { name: 'tool result reached the model', ok: events.some((e) => e.type === 'tool.result' && !e.payload['isError']), detail: `${events.filter((e) => e.type === 'tool.result').length} tool result(s)` },
    { name: 'final answer', ok: Boolean(result.finalText), detail: result.finalText ? result.finalText.slice(0, 200) : 'none' },
    { name: 'usage reported', ok: result.usage !== undefined && !events.some((e) => e.type === 'usage.delta' && e.payload['estimated'] === true), detail: `${facts.map((f) => f.usage).join(', ') || 'no responses'}; totals ${JSON.stringify(result.usage ?? {})}` },
    { name: 'model reported', ok: Boolean(result.model), detail: `requested ${o.model}, provider reported ${result.model ?? 'none'}${result.model && result.model !== o.model ? ' (different)' : ''}` },
  ];
  const report: ConformanceReport = {
    ok: checks.every((c) => c.ok), checks, captures, elapsedMs, rssMb: Math.round(process.memoryUsage().rss / 1048576), finalText: result.finalText,
    error: result.error ? `${result.error.code}: ${result.error.message}` : null,
  };
  const shape = { wire: facts, elapsedMs, rssMb: report.rssMb };
  writeFileSync(join(o.outDir, 'report.json'), JSON.stringify({ ...report, ...shape }, null, 2));
  return report;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]!; if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true'; }
  return out;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (!a['base-url'] || !a['model'] || !a['out']) {
    process.stderr.write('usage: conformance --base-url <https://host/v1> --model <id> --out <dir outside the repo> [--key-env <ENV_VAR>] [--auth bearer|none|header:<Name>]\n');
    process.exit(2);
  }
  try {
    const r = await runConformance({ baseUrl: a['base-url'], model: a['model'], outDir: resolve(a['out']), ...(a['key-env'] ? { keyEnv: a['key-env'] } : {}), ...(a['auth'] ? { auth: a['auth'] } : {}), log: (l) => process.stderr.write(`${l}\n`) });
    for (const c of r.checks) process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}\n`);
    process.stdout.write(`\n${r.ok ? 'OK' : 'FAILED'} in ${r.elapsedMs} ms, harness RSS ${r.rssMb} MB\ncaptures:\n${r.captures.map((f) => `  ${f}`).join('\n')}\nreport: ${join(resolve(a['out']), 'report.json')}\n`);
    process.exit(r.ok ? 0 : 1);
  } catch (e) { process.stderr.write(`conformance: ${(e as Error).message}\n`); process.exit(2); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
