/** `conductor usage` against a stub daemon: plan limits on a subscription, cost on a metered window. */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program.js';
import { configureOutput } from './output.js';

let server: Server | null = null;
let url = '';
let routes: Record<string, unknown> = {};

beforeEach(async () => {
  routes = {};
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const body = routes[path];
      res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? { error: { code: 'not_found', message: `no stub for ${path}`, retryable: false } }));
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
    await buildProgram().parseAsync(['node', 'conductor', '--url', url, '-w', 'ws1', ...argv], { from: 'node' });
  } finally {
    spy.mockRestore();
    configureOutput({ json: false });
  }
  return out;
}

const total = { tokensIn: 900, tokensOut: 100, tokensCached: 50, runs: 3, durationMs: 0, costCents: 250, costReportedCents: 0 };

function seedSeries(billingMix: Record<string, number>): void {
  routes['/api/w/ws1/usage'] = {
    range: { start: 's', end: 'e', window: '24h', grain: 'hour', prevStart: 'ps', prevEnd: 'pe' },
    points: [{ bucket: '2026-09-05T17:00:00.000Z', ...total }],
    total, previous: total, costReportedShare: 0, billingMix,
  };
}

const subscription = {
  workspaceId: 'ws1', runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max',
  limitsAvailable: true,
  limits: [
    { kind: 'session', label: 'Session', utilization: 42, resetsAt: new Date(Date.now() + 35 * 60_000).toISOString(), scopeLabel: null },
    { kind: 'weekly_scoped', label: 'Weekly', utilization: 25, resetsAt: new Date(Date.now() + 4 * 86_400_000).toISOString(), scopeLabel: 'Fable' },
  ],
  note: null, capturedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
};

describe('conductor usage', () => {
  it('prints the plan windows and no cost line for an all-subscription window', async () => {
    seedSeries({ subscription: 1000, metered: 0, unknown: 0 });
    routes['/api/w/ws1/usage/accounts'] = [subscription];
    const out = await cli('usage');
    expect(out).toContain('claude · max');
    expect(out).toContain('Session');
    expect(out).toContain('42%');
    expect(out).toContain('resets in 35m');
    expect(out).toContain('Weekly · Fable');
    expect(out).not.toMatch(/^\s*cost /m);
  });

  it('keeps the cost line when any of the window was metered', async () => {
    seedSeries({ subscription: 1000, metered: 5, unknown: 0 });
    routes['/api/w/ws1/usage/accounts'] = [subscription];
    expect(await cli('usage')).toMatch(/^\s*cost /m);
  });

  it('says the limits are unavailable rather than printing zeros', async () => {
    seedSeries({ subscription: 1000, metered: 0, unknown: 0 });
    routes['/api/w/ws1/usage/accounts'] = [{
      ...subscription, runtimeId: 'codex', planLabel: null, limitsAvailable: false, limits: [],
      note: 'codex: the CLI keeps plan limits in its session rollout file',
    }];
    const out = await cli('usage');
    expect(out).toContain('limits unavailable');
    expect(out).toContain('session rollout file');
    // No window is drawn at all, so there is no bar sitting at zero.
    expect(out).not.toMatch(/\n\s+(Session|Weekly)\s/);
  });

  it('is unchanged when nothing has been probed', async () => {
    seedSeries({ subscription: 0, metered: 0, unknown: 1000 });
    routes['/api/w/ws1/usage/accounts'] = [];
    const out = await cli('usage');
    expect(out).toMatch(/^\s*cost /m);
    expect(out).not.toContain('limits unavailable');
  });

  it('drops the COST column from --series on a subscription window', async () => {
    seedSeries({ subscription: 1000, metered: 0, unknown: 0 });
    routes['/api/w/ws1/usage/accounts'] = [subscription];
    const out = await cli('usage', '--series');
    expect(out).toContain('BUCKET');
    expect(out).toContain('TOKENS');
    expect(out).not.toContain('COST');
  });
});
