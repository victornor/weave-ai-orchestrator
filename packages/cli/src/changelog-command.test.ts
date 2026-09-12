/** `weave changelog` against a stub daemon: scoping, the date range, and the machine-readable form. */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogEntry } from '@weave-ai/shared';
import { buildProgram } from './program.js';
import { configureOutput } from './output.js';

let server: Server | null = null;
let url = '';
let routes: Record<string, unknown> = {};
/** Every request the CLI made, so a test can assert what it asked the daemon for. */
let seen: string[] = [];

beforeEach(async () => {
  routes = {};
  seen = [];
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push(req.url ?? '');
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

let n = 0;
function entry(at: string, over: Partial<ChangelogEntry> = {}): ChangelogEntry {
  n += 1;
  return {
    id: `e${n}`, at, kind: 'landed',
    actor: { kind: 'human', id: 'victor', label: 'the workspace owner' },
    projectId: 'p1', ticketId: 't1', ticketIdentifier: `ACME-${n}`,
    summary: `Landed: thing ${n}`, link: { kind: 'ticket', target: 't1' },
    ...over,
  };
}

/** Every date the CLI prints is bucketed in the machine's timezone, so the fixtures use midday UTC. */
const seed = (entries: ChangelogEntry[], nextCursor: string | null = null) => {
  routes['/api/w/ws1/changelog'] = { entries, nextCursor };
};

beforeEach(() => { n = 0; });

describe('weave changelog', () => {
  it('prints the workspace changelog newest first with kind, ticket, summary and actor', async () => {
    seed([
      entry('2026-09-05T12:00:00.000Z', { summary: 'Landed: dark mode', ticketIdentifier: 'ACME-42' }),
      entry('2026-09-04T12:00:00.000Z', { kind: 'filed', summary: 'Filed change: dark mode', ticketIdentifier: 'ACME-42' }),
    ]);
    const out = await cli('changelog', '--from', '2026-09-01', '--to', '2026-09-30');
    expect(out).toContain('landed');
    expect(out).toContain('Landed: dark mode');
    expect(out).toContain('ACME-42');
    expect(out).toContain('the workspace owner');
    expect(out.indexOf('Landed: dark mode')).toBeLessThan(out.indexOf('Filed change: dark mode'));
  });

  it('asks for one project when given one', async () => {
    seed([entry('2026-09-05T12:00:00.000Z')]);
    await cli('changelog', '--project', 'p1', '--from', '2026-09-01', '--to', '2026-09-30');
    expect(seen.some((u) => u.includes('project=p1'))).toBe(true);
  });

  it('asks for the whole workspace when given no project', async () => {
    seed([entry('2026-09-05T12:00:00.000Z')]);
    await cli('changelog', '--from', '2026-09-01', '--to', '2026-09-30');
    expect(seen.some((u) => u.includes('project='))).toBe(false);
  });

  it('prints only the entries inside the range, both ends inclusive', async () => {
    seed([
      entry('2026-09-06T12:00:00.000Z', { summary: 'after the range' }),
      entry('2026-09-05T12:00:00.000Z', { summary: 'the last day' }),
      entry('2026-09-03T12:00:00.000Z', { summary: 'the first day' }),
      entry('2026-09-02T12:00:00.000Z', { summary: 'before the range' }),
    ]);
    const out = await cli('changelog', '--from', '2026-09-03', '--to', '2026-09-05');
    expect(out).toContain('the last day');
    expect(out).toContain('the first day');
    expect(out).not.toContain('after the range');
    expect(out).not.toContain('before the range');
  });

  it('prints from a start up to now when only a start is given', async () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString();
    seed([entry(recent, { summary: 'yesterday' })]);
    const out = await cli('changelog', '--from', '2020-01-01');
    expect(out).toContain('yesterday');
  });

  it('names the default range it used when none is given', async () => {
    seed([]);
    const out = await cli('changelog');
    expect(out).toMatch(/the last 30 days/);
    expect(out).toMatch(/\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/);
  });

  it('says so rather than printing an empty table when nothing happened', async () => {
    seed([]);
    const out = await cli('changelog', '--from', '2026-09-01', '--to', '2026-09-02');
    expect(out).toContain('nothing happened in this range');
  });

  it('fails on an inverted range without printing entries', async () => {
    seed([entry('2026-09-05T12:00:00.000Z', { summary: 'should never print' })]);
    const out = await cli('changelog', '--from', '2026-09-05', '--to', '2026-09-01');
    expect(out).not.toContain('should never print');
    expect(process.exitCode).not.toBe(0);
  });

  it('rejects a date that is not a date', async () => {
    seed([]);
    const out = await cli('changelog', '--from', 'last tuesday');
    expect(out).not.toContain('WHEN');
    expect(process.exitCode).not.toBe(0);
  });

  it('fails naming the project when the daemon does not know it', async () => {
    routes['/api/w/ws1/changelog'] = undefined;
    const out = await cli('changelog', '--project', 'nope', '--from', '2026-09-01', '--to', '2026-09-02');
    expect(out).not.toContain('WHEN');
    expect(process.exitCode).not.toBe(0);
  });

  it('emits the entry fields and no decoration with --json', async () => {
    seed([entry('2026-09-05T12:00:00.000Z', { summary: 'Landed: dark mode', ticketIdentifier: 'ACME-42' })]);
    const out = await cli('--json', 'changelog', '--from', '2026-09-01', '--to', '2026-09-30');
    const parsed = JSON.parse(out) as { from: string; to: string; timezone: string; entries: ChangelogEntry[] };
    expect(parsed.from).toBe('2026-09-01');
    expect(parsed.to).toBe('2026-09-30');
    expect(parsed.timezone).toBeTruthy();
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({
      at: '2026-09-05T12:00:00.000Z', kind: 'landed', ticketIdentifier: 'ACME-42',
      summary: 'Landed: dark mode', link: { kind: 'ticket', target: 't1' },
    });
    expect(parsed.entries[0]!.actor).toMatchObject({ kind: 'human', label: 'the workspace owner' });
    expect(out).not.toContain('WHEN');
  });
});
