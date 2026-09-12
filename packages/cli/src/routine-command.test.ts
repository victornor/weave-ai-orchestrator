/** `weave routine add|list|pause` against a stub daemon (VS-220). */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Routine } from '@weave-ai/shared';
import { buildProgram } from './program.js';
import { configureOutput } from './output.js';

interface Call { method: string; path: string; body: unknown }

let server: Server | null = null;
let url = '';
let calls: Call[] = [];
let store: Routine[] = [];

function asRoutine(over: Partial<Routine> = {}): Routine {
  return {
    id: over.id ?? `rt_${store.length + 1}`,
    workspaceId: 'ws1',
    name: over.name ?? 'Morning review',
    trigger: over.trigger ?? { kind: 'schedule', timezone: 'UTC', daily: { hour: 7, minute: 0 } },
    template: over.template ?? { instruction: 'Look at incidents', action: 'report', maxTicketsPerFire: 0, projectId: null },
    roleId: null,
    concurrency: 'skip_if_active',
    status: over.status ?? 'active',
    lastFiredAt: null,
    nextFireAt: over.nextFireAt ?? '2026-09-12T07:00:00.000Z',
    inFlightWakeId: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
  };
}

beforeEach(async () => {
  calls = [];
  store = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined;
      calls.push({ method: req.method ?? '', path, body });
      let status = 200;
      let payload: unknown = { error: { code: 'not_found', message: `no stub for ${req.method} ${path}`, retryable: false } };
      if (req.method === 'GET' && path === '/api/w/ws1/routines') {
        payload = { items: store };
      } else if (req.method === 'POST' && path === '/api/w/ws1/routines') {
        const row = asRoutine({
          name: String(body?.['name'] ?? ''),
          trigger: body?.['trigger'] as Routine['trigger'],
          template: {
            instruction: String(body?.['instruction'] ?? ''),
            action: (body?.['action'] as Routine['template']['action'] | undefined) ?? 'report',
            maxTicketsPerFire: Number(body?.['maxTicketsPerFire'] ?? 0),
            projectId: (body?.['projectId'] as string | null | undefined) ?? null,
          },
        });
        store.push(row);
        status = 201;
        payload = row;
      } else if (req.method === 'PATCH' && path.startsWith('/api/w/ws1/routines/')) {
        const id = path.split('/').pop()!;
        const idx = store.findIndex((r) => r.id === id);
        if (idx >= 0) {
          const next = { ...store[idx]!, status: (body?.['status'] as Routine['status'] | undefined) ?? store[idx]!.status };
          store[idx] = next;
          payload = next;
        } else {
          status = 404;
        }
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  server = null;
  process.exitCode = undefined;
});

async function cli(...argv: string[]): Promise<string> {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { out += String(chunk); return true; });
  try {
    await buildProgram().parseAsync(['node', 'conductor', '--url', url, '--no-color', '-w', 'ws1', ...argv], { from: 'node' });
  } finally {
    spy.mockRestore();
    configureOutput({ json: false });
  }
  return out;
}

describe('weave routine', () => {
  it('adds then lists the scheduled task', async () => {
    await cli('routine', 'add', '--name', 'Morning review', '--daily', '07:00', '--tz', 'UTC', '--instruction', 'Look at incidents');
    const out = await cli('routine', 'list');
    expect(out).toContain('Morning review');
    expect(out).toContain('daily 07:00 UTC');
    expect(out).toContain('active');
    const posted = calls.find((c) => c.method === 'POST' && c.path === '/api/w/ws1/routines');
    expect(posted?.body).toMatchObject({
      name: 'Morning review',
      instruction: 'Look at incidents',
      trigger: { kind: 'schedule', timezone: 'UTC', daily: { hour: 7, minute: 0 } },
    });
  });

  it('pause then list shows paused', async () => {
    store.push(asRoutine({ id: 'rt_1' }));
    await cli('routine', 'pause', 'rt_1');
    const out = await cli('routine', 'list');
    expect(out).toContain('paused');
    const patched = calls.find((c) => c.method === 'PATCH');
    expect(patched).toMatchObject({ path: '/api/w/ws1/routines/rt_1', body: { status: 'paused' } });
  });
});
