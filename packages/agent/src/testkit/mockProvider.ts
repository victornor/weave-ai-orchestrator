import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One scripted reply. `raw` is sent as recorded bytes; `chunks` are JSON objects framed as SSE. */
export interface MockStep {
  raw?: string | Buffer;
  chunks?: unknown[];
  /** Split the bytes at these offsets, one write per piece (mid-line and mid-UTF-8 splits included). */
  splitAt?: number[];
  status?: number;
  headers?: Record<string, string>;
  /** A non-SSE body for an error status. */
  body?: string;
  /** Close the connection after this many bytes without finishing the stream. */
  dropAfterBytes?: number;
  /** Do not send `data: [DONE]`. */
  noDone?: boolean;
  /** Hold the response open, sending nothing (or nothing more, after `raw`/`chunks`), until the client goes away. */
  stall?: boolean;
  /** Delay before the first byte, ms. */
  delayMs?: number;
  /** Pause between pieces, ms. */
  pieceDelayMs?: number;
}
export interface RecordedRequest { method: string; url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }

export interface MockProvider {
  baseUrl: string;
  requests: RecordedRequest[];
  /** Queue replies, consumed one per chat-completions request. */
  script(...steps: MockStep[]): void;
  close(): Promise<void>;
}

export const frame = (chunks: unknown[], done = true): string => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');

export const textChunks = (text: string, model = 'mock-model', usage: unknown = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }): unknown[] => [
  { id: 'c1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { id: 'c1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
];
export const toolCallChunks = (calls: Array<{ id: string; name: string; args: string }>, model = 'mock-model', usage: unknown = { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }): unknown[] => [
  ...calls.flatMap((c, i) => [
    { id: 'c1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] }, finish_reason: null }] },
    ...c.args.match(/.{1,7}/gs)!.map((piece) => ({ id: 'c1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: piece } }] }, finish_reason: null }] })),
  ]),
  { id: 'c1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage },
];

/** A real HTTP server on loopback serving `/v1/chat/completions` from a script, recording every request body so tests assert what was sent. */
export async function startMockProvider(): Promise<MockProvider> {
  const requests: RecordedRequest[] = [];
  const queue: MockStep[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req, res) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(s || '{}'); } catch { /* recorded empty */ }
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      void reply(res, queue.shift());
    });
  });
  server.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    script: (...steps) => { queue.push(...steps); },
    close: () => new Promise<void>((r) => { for (const sock of sockets) sock.destroy(); server.close(() => r()); }),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function reply(res: ServerResponse, step: MockStep | undefined): Promise<void> {
  if (!step) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"mock provider script exhausted"}}'); return; }
  if (step.delayMs) await sleep(step.delayMs);
  if (step.status && step.status !== 200) { res.writeHead(step.status, { 'content-type': 'application/json', ...step.headers }); res.end(step.body ?? '{}'); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...step.headers });
  if (step.stall && step.raw === undefined && step.chunks === undefined) return;
  let bytes = Buffer.from(step.raw ?? frame(step.chunks ?? [], !step.noDone));
  if (step.dropAfterBytes !== undefined) bytes = bytes.subarray(0, step.dropAfterBytes);
  const cuts = [0, ...(step.splitAt ?? []).filter((n) => n > 0 && n < bytes.length), bytes.length];
  for (let i = 0; i + 1 < cuts.length; i++) {
    res.write(bytes.subarray(cuts[i]!, cuts[i + 1]!));
    if (step.pieceDelayMs) await sleep(step.pieceDelayMs);
  }
  if (step.dropAfterBytes !== undefined) res.destroy(); else if (!step.stall) res.end();
}
