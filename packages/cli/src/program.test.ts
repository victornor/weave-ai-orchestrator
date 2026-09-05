import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { buildProgram } from './program.js';
import { configureOutput } from './output.js';
import { parseAssignments } from './commands/workspace.js';

function find(program: Command, path: string[]): Command | undefined {
  let node: Command | undefined = program;
  for (const name of path) {
    node = node?.commands.find((c) => c.name() === name || c.aliases().includes(name));
    if (!node) return undefined;
  }
  return node;
}

/** `addHelpText('after')` only reaches the writer, not `helpInformation()`. */
function helpOf(command: Command): string {
  let out = '';
  command.configureOutput({ writeOut: (str) => { out += str; } });
  command.outputHelp();
  return out;
}

describe('command tree', () => {
  const program = buildProgram();

  it('exposes every top-level command from PLAN §20', () => {
    const expected = [
      'init', 'daemon', 'login', 'logout', 'context', 'devices', 'presenter', 'project', 'runtime', 'role',
      'worker', 'ticket', 'decision', 'chat', 'say', 'briefing', 'attach', 'top', 'presentation', 'conductor',
      'workspace', 'runs', 'usage', 'knowledge', 'specs', 'worktree', 'doctor', 'agent',
    ];
    const actual = program.commands.map((c) => c.name());
    for (const name of expected) expect(actual).toContain(name);
  });

  it.each([
    ['daemon', ['start', 'stop', 'status', 'logs', 'set-password', 'install-service']],
    ['context', ['list', 'use', 'remove', 'show']],
    ['devices', ['list', 'revoke']],
    ['project', ['add', 'list', 'show', 'remove', 'fetch', 'set-runtime', 'set-policy']],
    ['runtime', ['list', 'detect', 'login', 'models']],
    ['role', ['list', 'show', 'activate', 'set-runtime', 'set-model', 'pause', 'resume', 'retire', 'charter']],
    ['worker', ['list', 'show', 'pause', 'resume', 'relaunch', 'cancel', 'purge']],
    ['ticket', ['create', 'list', 'show', 'assign', 'set', 'transition', 'comment', 'cancel', 'discard', 'open']],
    ['decision', ['list', 'show', 'answer']],
    ['presentation', ['set', 'open', 'reconcile', 'status']],
    ['conductor', ['set-model', 'set-runtime', 'show', 'reset-session']],
    ['workspace', ['list', 'use', 'register', 'unregister', 'set-default', 'pause', 'resume', 'export', 'import']],
    ['runs', ['list', 'show', 'tail', 'cancel']],
    ['knowledge', ['show', 'edit', 'note', 'lint', 'curate', 'revert']],
    ['specs', ['list', 'show', 'changes', 'search', 'explore']],
    ['worktree', ['list', 'verify', 'discard']],
    ['agent', ['inbox']],
  ])('%s has its subcommands', (group, subcommands) => {
    for (const name of subcommands) expect(find(program, [group, name])?.name(), `${group} ${name}`).toBe(name);
  });

  it('turns `workspace set-default` assignments into a nested patch', () => {
    expect(parseAssignments(['knowledgeBudgetTokens.project=20000', 'autoMerge=true', 'model=opus'])).toEqual({
      knowledgeBudgetTokens: { project: 20000 }, autoMerge: true, model: 'opus',
    });
    expect(parseAssignments(['knowledgeBudgetTokens.project=1', 'knowledgeBudgetTokens.document=2']))
      .toEqual({ knowledgeBudgetTokens: { project: 1, document: 2 } });
    expect(() => parseAssignments(['knowledgeBudgetTokens.project'])).toThrow(/not a key=value pair/);
  });

  it('offers --launchd on `daemon install-service` and --out/--target on workspace export/import', () => {
    expect(find(program, ['daemon', 'install-service'])!.options.map((o) => o.long)).toEqual(expect.arrayContaining(['--print', '--launchd']));
    expect(find(program, ['workspace', 'export'])!.options.map((o) => o.long)).toContain('--out');
    expect(find(program, ['workspace', 'import'])!.options.map((o) => o.long)).toContain('--target');
  });

  it('documents the limits of export and import in the command help', () => {
    expect(helpOf(find(program, ['workspace', 'export'])!)).toMatch(/Never carries/);
    expect(helpOf(find(program, ['workspace', 'import'])!)).toMatch(/Does not:/);
    expect(helpOf(find(program, ['project', 'set-policy'])!)).toMatch(/mergeMethod=squash/);
    expect(helpOf(find(program, ['daemon', 'install-service'])!)).toMatch(/only on macOS/);
  });

  it('carries the global flags every command needs', () => {
    const flags = program.options.map((o) => o.long);
    expect(flags).toEqual(expect.arrayContaining(['--workspace', '--json', '--no-color', '--context', '--url', '--token']));
  });

  it('charter has show and rollback', () => {
    expect(find(program, ['role', 'charter', 'show'])).toBeDefined();
    expect(find(program, ['role', 'charter', 'rollback'])).toBeDefined();
  });

  it('exposes --auto-merge on `ticket set` and --force on `ticket discard`', () => {
    expect(find(program, ['ticket', 'set'])!.options.map((o) => o.long)).toEqual(expect.arrayContaining(['--auto-merge', '--no-auto-merge']));
    expect(find(program, ['ticket', 'discard'])!.options.map((o) => o.long)).toContain('--force');
  });

  it('exposes the usage scope/window/grain flags', () => {
    expect(find(program, ['usage'])!.options.map((o) => o.long)).toEqual(expect.arrayContaining(['--scope', '--window', '--grain', '--start', '--end']));
  });
});

describe('running commands against a stubbed daemon', () => {
  const realFetch = globalThis.fetch;
  let written: string[];
  // The CLI resolves its workspace by walking up from the working directory. A checkout that lives
  // under a workspace (every worker worktree does) would find that `workspace.yaml` and change what
  // these commands do, so each run happens in a temporary directory with no workspace above it.
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'ac-cli-'));
    vi.spyOn(process, 'cwd').mockReturnValue(sandbox);
    written = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { written.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => { written.push(String(chunk)); return true; });
    process.exitCode = undefined;
    configureOutput({ json: true, color: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(sandbox, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    process.exitCode = undefined;
  });

  function stubFetch(routes: Record<string, unknown>): string[] {
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push(`${init?.method ?? 'GET'} ${url.replace(/^http:\/\/daemon\.test/, '')}`);
      const key = Object.keys(routes).find((route) => url.includes(route));
      if (!key) return new Response(JSON.stringify({ error: { code: 'not_found', message: `no stub for ${url}`, retryable: false } }), { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return seen;
  }

  const base = ['node', 'conductor', '--json', '--url', 'http://daemon.test', '-w', 'acme'];

  it('prints tickets as json and calls the workspace route', async () => {
    const seen = stubFetch({
      '/api/w/acme/tickets': { items: [{ id: 't1', identifier: 'ACME-42', title: 'Theme tokens', kind: 'change', status: 'in_progress', priority: 'high', createdAt: '2026-09-04T11:00:00.000Z' }], total: 1 },
    });
    await buildProgram().parseAsync([...base, 'ticket', 'list', '--status', 'in_progress']);
    expect(seen[0]).toBe('GET /api/w/acme/tickets?status=in_progress&limit=50&offset=0');
    expect(JSON.parse(written.join(''))).toMatchObject({ items: [{ identifier: 'ACME-42' }] });
    expect(process.exitCode).toBeUndefined();
  });

  it('renders the briefing from the render package', async () => {
    stubFetch({
      '/api/w/acme/briefing': {
        needsYou: [], landed: [], underway: [], queued: [], warnings: [], generatedAt: '2026-09-04T12:00:00.000Z',
      },
    });
    configureOutput({ json: false, color: false });
    await buildProgram().parseAsync([...base.filter((a) => a !== '--json'), 'briefing']);
    const text = written.join('');
    expect(text).toContain('Needs you');
    expect(text).toContain('Nothing needs you right now.');
    expect(text).toContain('Queued');
  });

  it('answers a decision by option number', async () => {
    const seen = stubFetch({
      '/api/w/acme/decisions/dec_1/answer': { ok: true },
      '/api/w/acme/decisions/dec_1': {
        id: 'dec_1', kind: 'plan_approval', owner: 'human', status: 'open', title: 'Approve the plan',
        options: [], allowFreeText: false, createdAt: '2026-09-04T11:00:00.000Z', ticketId: 'tkt_1',
      },
    });
    await buildProgram().parseAsync([...base, 'decision', 'answer', 'dec_1', '2']);
    expect(seen).toContain('POST /api/w/acme/decisions/dec_1/answer');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints a typed error and sets an exit code when the daemon refuses', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: { code: 'runtime_unreachable', message: 'claude is not installed on the daemon host', retryable: true } }),
      { status: 503 },
    )) as typeof fetch;
    await buildProgram().parseAsync([...base, 'worker', 'list']);
    expect(JSON.parse(written.join(''))).toMatchObject({ error: { code: 'runtime_unreachable', retryable: true } });
    expect(process.exitCode).toBe(1);
  });

  it('reports an unreachable daemon with exit code 4', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'project', 'list']);
    expect(JSON.parse(written.join(''))).toMatchObject({ error: { code: 'net_daemon_unreachable' } });
    expect(process.exitCode).toBe(4);
  });

  it('fails cleanly when no workspace can be resolved', async () => {
    stubFetch({ '/api/health': { ok: true, workspaces: [{ id: 'a' }, { id: 'b' }] } });
    await buildProgram().parseAsync(['node', 'conductor', '--json', '--url', 'http://daemon.test', 'ticket', 'list']);
    expect(written.join('')).toContain('no workspace selected');
    expect(process.exitCode).toBe(1);
  });

  it('adopts the only workspace the daemon serves', async () => {
    const seen = stubFetch({
      '/api/health': { ok: true, workspaces: [{ id: 'only' }] },
      '/api/w/only/projects': [{ id: 'api', name: 'api', status: 'ready' }],
    });
    await buildProgram().parseAsync(['node', 'conductor', '--json', '--url', 'http://daemon.test', 'project', 'list']);
    expect(seen).toContain('GET /api/w/only/projects');
  });

  it('pauses and resumes the workspace', async () => {
    const seen = stubFetch({ '/api/w/acme/pause': { id: 'acme', status: 'paused' }, '/api/w/acme/resume': { id: 'acme', status: 'active' } });
    await buildProgram().parseAsync([...base, 'workspace', 'pause']);
    await buildProgram().parseAsync([...base, 'workspace', 'resume']);
    expect(seen).toEqual(['POST /api/w/acme/pause', 'POST /api/w/acme/resume']);
  });

  it('exports the workspace with an explicit output directory', async () => {
    const seen = stubFetch({ '/api/w/acme/export': { path: '/ws/exports/x', roles: 2, knowledgeFiles: 3, tickets: 4 } });
    await buildProgram().parseAsync([...base, 'workspace', 'export', '--out', '/tmp/ac-export']);
    expect(seen).toContain('POST /api/w/acme/export');
    expect(JSON.parse(written.join(''))).toMatchObject({ path: '/ws/exports/x', tickets: 4 });
  });

  it('imports an export into a target workspace directory', async () => {
    const seen = stubFetch({ '/api/workspaces/import': { id: 'acme', path: '/ws', created: true, roles: 1, knowledgeFiles: 2, tickets: 3, skipped: 0 } });
    await buildProgram().parseAsync([...base, 'workspace', 'import', '/tmp/pkg', '--target', '/tmp/ws']);
    expect(seen).toContain('POST /api/workspaces/import');
    expect(JSON.parse(written.join(''))).toMatchObject({ id: 'acme', tickets: 3 });
  });

  it('sets a project runtime', async () => {
    const seen = stubFetch({ '/api/w/acme/projects/api': { id: 'api', runtimeId: 'codex' } });
    await buildProgram().parseAsync([...base, 'project', 'set-runtime', 'api', 'codex']);
    expect(seen).toContain('PATCH /api/w/acme/projects/api');
  });

  it('merges project policies instead of replacing them', async () => {
    let patched: unknown = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') { patched = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: 'api' }), { status: 200 }); }
      return new Response(JSON.stringify({ id: 'api', policies: { mergeMethod: 'squash', requireCi: true } }), { status: 200 });
    }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'project', 'set-policy', 'api', 'requireCi=false', 'deliveryMode=local-branch']);
    expect(patched).toEqual({ policies: { mergeMethod: 'squash', requireCi: false, deliveryMode: 'local-branch' } });
  });

});
