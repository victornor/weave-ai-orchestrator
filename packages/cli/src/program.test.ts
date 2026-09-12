import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { buildProgram, VERSION } from './program.js';
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

  it('reports a git sha as --version, not 0.1.0', () => {
    expect(VERSION).not.toBe('0.1.0');
    expect(VERSION).toMatch(/^(?:[0-9a-f]{7,40}|unknown)$/);
    expect(program.version()).toBe(VERSION);
  });

  it('exposes every top-level command from PLAN §20', () => {
    const expected = [
      'init', 'daemon', 'login', 'logout', 'context', 'devices', 'presenter', 'project', 'runtime', 'role',
      'worker', 'ticket', 'decision', 'chat', 'say', 'briefing', 'attach', 'top', 'presentation', 'weaver',
      'workspace', 'runs', 'usage', 'knowledge', 'specs', 'worktree', 'doctor', 'agent',
    ];
    const actual = program.commands.map((c) => c.name());
    for (const name of expected) expect(actual).toContain(name);
  });

  it.each([
    ['daemon', ['start', 'stop', 'status', 'logs', 'set-password', 'install-service', 'upgrade', 'update', 'releases', 'rollback', 'models']],
    ['daemon update', ['apply', 'cancel']],
    ['context', ['list', 'use', 'remove', 'show']],
    ['devices', ['list', 'revoke']],
    ['project', ['add', 'list', 'show', 'remove', 'fetch', 'set-policy']],
    ['runtime', ['list', 'detect', 'login', 'models']],
    ['role', ['list', 'show', 'activate', 'set-max-workers', 'pause', 'resume', 'retire', 'charter']],
    ['worker', ['list', 'show', 'pause', 'resume', 'relaunch', 'cancel', 'purge']],
    ['ticket', ['create', 'list', 'show', 'assign', 'set', 'transition', 'comment', 'cancel', 'discard', 'open']],
    ['decision', ['list', 'show', 'answer']],
    ['presentation', ['set', 'open', 'reconcile', 'status']],
    ['weaver', ['show', 'reset-session']],
    // Model selection, whole and entire (VS-77).
    ['models', ['show', 'set', 'options']],
    ['workspace', ['list', 'use', 'register', 'unregister', 'set-default', 'pause', 'resume', 'export', 'import']],
    ['runs', ['list', 'show', 'tail', 'cancel']],
    ['knowledge', ['show', 'edit', 'note', 'lint', 'curate', 'revert']],
    ['specs', ['list', 'show', 'changes', 'search', 'explore']],
    ['worktree', ['list', 'verify', 'discard']],
    ['agent', ['inbox']],
  ])('%s has its subcommands', (group, subcommands) => {
    const path = group.split(' ');
    for (const name of subcommands) expect(find(program, [...path, name])?.name(), `${group} ${name}`).toBe(name);
  });

  it('keeps the upgrade runner out of the help: the daemon starts it, never a human', () => {
    const runner = find(program, ['daemon', 'upgrade-runner']);
    expect(runner?.name()).toBe('upgrade-runner');
    expect(helpOf(find(program, ['daemon'])!)).not.toContain('upgrade-runner');
  });

  it('keeps `daemon upgrade` — the path that works when the daemon is not answering — alongside `daemon update`', () => {
    const local = find(program, ['daemon', 'upgrade'])!;
    const options = local.options.map((o) => o.long);
    expect(options).toEqual(expect.arrayContaining(['--from', '--ref', '--test', '--no-restart', '--drain-timeout']));
    expect(local.description()).toContain('build a release from git');
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

  it('documents the YOLO mode key on both policy setters', () => {
    expect(helpOf(find(program, ['workspace', 'set-default'])!)).toMatch(/yolo=true\|false/);
    expect(helpOf(find(program, ['project', 'set-policy'])!)).toMatch(/yolo=true\|false/);
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

  it('exposes --summary on ticket create and ticket set (VS-146)', () => {
    expect(find(program, ['ticket', 'create'])!.options.map((o) => o.long)).toContain('--summary');
    expect(find(program, ['ticket', 'set'])!.options.map((o) => o.long)).toContain('--summary');
  });

  it('exposes --worker-model on ticket create and models options add|set|remove (VS-162)', () => {
    expect(find(program, ['ticket', 'create'])!.options.map((o) => o.long)).toContain('--worker-model');
    expect(find(program, ['models', 'options', 'add'])?.name()).toBe('add');
    expect(find(program, ['models', 'options', 'set'])?.name()).toBe('set');
    expect(find(program, ['models', 'options', 'remove'])?.name()).toBe('remove');
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

  it('prints one project merge queue as json', async () => {
    const seen = stubFetch({
      '/api/w/acme/projects/api/merge-queue': {
        projectId: 'api', concurrency: 1,
        active: [{ ticketId: 't1', identifier: 'ACME-42', title: 'Theme tokens', position: null, queuedAt: '2026-09-04T11:00:00.000Z', startedAt: '2026-09-04T11:00:05.000Z' }],
        waiting: [{ ticketId: 't2', identifier: 'ACME-43', title: 'Behind it', position: 1, queuedAt: '2026-09-04T11:30:00.000Z', startedAt: null }],
      },
    });
    await buildProgram().parseAsync([...base, 'ticket', 'merge-queue', '--project', 'api']);
    expect(seen[0]).toBe('GET /api/w/acme/projects/api/merge-queue');
    expect(JSON.parse(written.join(''))).toMatchObject({ concurrency: 1, waiting: [{ identifier: 'ACME-43', position: 1 }] });
    expect(process.exitCode).toBeUndefined();
  });

  it('prints the merge queue as a table with the merging ticket first', async () => {
    stubFetch({
      '/api/w/acme/projects/api/merge-queue': {
        projectId: 'api', concurrency: 1,
        active: [{ ticketId: 't1', identifier: 'ACME-42', title: 'Theme tokens', position: null, queuedAt: '2026-09-04T11:00:00.000Z', startedAt: '2026-09-04T11:00:05.000Z' }],
        waiting: [{ ticketId: 't2', identifier: 'ACME-43', title: 'Behind it', position: 1, queuedAt: '2026-09-04T11:30:00.000Z', startedAt: null }],
      },
    });
    configureOutput({ json: false, color: false });
    await buildProgram().parseAsync([...base.filter((a) => a !== '--json'), 'ticket', 'merge-queue', '--project', 'api']);
    const text = written.join('');
    expect(text).toContain('merging 1/1, 1 waiting');
    expect(text).toMatch(/now\s+ACME-42/);
    expect(text).toMatch(/1\s+ACME-43/);
    expect(text).toContain('waiting');
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

  // VS-56: a stopped worker says why on the command line too, in the same words the web app uses.
  it('prints why a paused worker stopped in the worker list', async () => {
    stubFetch({
      '/api/w/acme/workers': {
        workers: [{
          id: 'ag_1', workspaceId: 'ws', kind: 'worker', projectId: 'p1', roleId: 'r1', ticketId: 'tk_1',
          name: 'Backend Engineer #1', runtimeId: 'claude', model: null, status: 'paused',
          pauseReason: 'rate_limit: waiting for a human',
          pauseDetail: { family: 'provider_quota', code: 'rate_limit', message: 'limit resets in 2 hours', resetAt: null, runId: 'r1' },
          turnCount: 3, homePath: '/w', createdAt: '2026-09-05T11:00:00.000Z', updatedAt: '2026-09-05T11:00:00.000Z',
        }],
      },
    });
    await buildProgram().parseAsync(['node', 'conductor', '--url', 'http://daemon.test', '-w', 'acme', 'worker', 'list']);
    const out = written.join('');
    expect(out).toContain('REASON');
    expect(out).toContain('provider_quota');
    expect(out).toContain('limit resets in 2 hours');
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

  it('sets a role max workers through the role patch route', async () => {
    const seen = stubFetch({ '/api/w/acme/roles/backend': { id: 'backend', maxWorkers: 6 } });
    await buildProgram().parseAsync([...base, 'role', 'set-max-workers', 'backend', '6', '--reason', 'the queue is backing up']);
    expect(seen).toContain('PATCH /api/w/acme/roles/backend');
    expect(JSON.parse(written.join(''))).toMatchObject({ maxWorkers: 6 });
    expect(process.exitCode).toBeUndefined();
  });

  it('refuses a max workers value outside 1-32 without calling the daemon', async () => {
    const seen = stubFetch({ '/api/w/acme/roles/backend': { id: 'backend' } });
    await buildProgram().parseAsync([...base, 'role', 'set-max-workers', 'backend', '99']);
    expect(seen).toHaveLength(0);
    expect(JSON.parse(written.join(''))).toMatchObject({ error: { code: 'validation' } });
    expect(process.exitCode).toBe(1);
  });

  it('shows the effective concurrency on a role', async () => {
    stubFetch({
      '/api/w/acme/roles/backend': {
        role: { id: 'backend', name: 'Backend Engineer', maxWorkers: 8, status: 'active' },
        charter: '# Charter', revisions: [], workers: [],
        concurrency: { roleMax: 8, projectMax: 4, effective: 4, live: 1, projectLive: 1, free: 3 },
      },
    });
    configureOutput({ json: false, color: false });
    await buildProgram().parseAsync([...base.filter((a) => a !== '--json'), 'role', 'show', 'backend']);
    const text = written.join('');
    expect(text).toContain('4 concurrent');
    expect(text).toContain('capped by the project limit of 4');
  });

  it('shows both model settings', async () => {
    const models = { weaver: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'codex', model: null, effort: 'high' } };
    const seen = stubFetch({ '/api/w/acme/models': models });
    await buildProgram().parseAsync([...base, 'models']);
    expect(seen).toContain('GET /api/w/acme/models');
  });

  it('sends the whole block with one setting changed, so the other is not dropped', async () => {
    const models = { weaver: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: null } };
    let put: unknown = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') { put = JSON.parse(String(init?.body)); return new Response(JSON.stringify(put), { status: 200 }); }
      return new Response(JSON.stringify(models), { status: 200 });
    }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'models', 'set', 'workers', '--runtime', 'codex', '--model', 'gpt-5']);
    expect(put).toEqual({
      weaver: { runtime: 'claude', model: 'claude-fable-5-1' },
      workers: { runtime: 'codex', model: 'gpt-5' },
    });
  });

  it('adds a worker option by GET-then-PUT of the whole block (VS-162)', async () => {
    const models = { weaver: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [] as unknown[] };
    let put: unknown = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') { put = JSON.parse(String(init?.body)); return new Response(JSON.stringify(put), { status: 200 }); }
      return new Response(JSON.stringify(models), { status: 200 });
    }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'models', 'options', 'add', '--id', 'cheap', '--description', 'Scouts.', '--runtime', 'opencode', '--model', 'glm-4.6']);
    expect(put).toEqual({
      weaver: { runtime: 'claude', model: null },
      workers: { runtime: 'claude', model: null },
      workerOptions: [{ id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' }],
    });
  });

  it('passes --worker-model on ticket create (VS-162)', async () => {
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ identifier: 'ACME-1', title: 'Add dark mode' }), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'ticket', 'create', 'Add dark mode', '--worker-model', 'cheap']);
    expect(body).toMatchObject({ workerModelId: 'cheap' });
  });

  it('models set always writes the workspace value, even while a daemon overlay is filled (VS-284)', async () => {
    const models = { weaver: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: null } };
    let put: unknown = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') { put = JSON.parse(String(init?.body)); return new Response(JSON.stringify(put), { status: 200 }); }
      return new Response(JSON.stringify(models), { status: 200 });
    }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'models', 'set', 'conductor', '--model', 'claude-opus-5']);
    expect(put).toEqual({ weaver: { runtime: 'claude', model: 'claude-opus-5' }, workers: { runtime: 'claude', model: null } });
    expect(process.exitCode).not.toBe(1);
  });

  it('daemon models set sends the overlay (VS-185)', async () => {
    const seen = stubFetch({
      '/api/daemon/models': { weaver: null, workers: null, workerOptions: null },
    });
    let put: unknown = null;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        put = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(put), { status: 200 });
      }
      return inner(input, init);
    }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'daemon', 'models', 'set', 'conductor', '--runtime', 'claude', '--model', 'claude-fable-5-1']);
    expect(put).toEqual({ weaver: { runtime: 'claude', model: 'claude-fable-5-1' } });
    expect(seen.some((s) => s.includes('/api/daemon/models'))).toBe(true);
  });

  it('prints that an unconfigured worker option has no runtime chosen (VS-236)', async () => {
    stubFetch({
      '/api/w/acme/models': {
        weaver: { runtime: 'claude', model: null },
        workers: { runtime: 'claude', model: null },
        workerOptions: [{ id: 'quick', description: 'Fastest.', runtime: null, model: null }],
      },
    });
    configureOutput({ json: false, color: false });
    await buildProgram().parseAsync([...base.filter((a) => a !== '--json'), 'models', 'show']);
    const text = written.join('');
    expect(text).toContain('no runtime chosen');
    expect(text).toMatch(/quick.*no runtime chosen/);
    expect(text).not.toMatch(/quick[^\n]*claude/);
  });

  it('prints the same for a daemon overlay option with runtime null (VS-236)', async () => {
    stubFetch({
      '/api/daemon/models': {
        weaver: null,
        workers: null,
        workerOptions: [{ id: 'deep', description: 'Cause unknown.', runtime: null, model: null }],
      },
    });
    configureOutput({ json: false, color: false });
    await buildProgram().parseAsync([...base.filter((a) => a !== '--json'), 'daemon', 'models', 'show']);
    const text = written.join('');
    expect(text).toContain('no runtime chosen');
    expect(text).toMatch(/deep.*no runtime chosen/);
    expect(text).not.toMatch(/deep[^\n]*claude/);
  });

  it('clears a model back to the runtime default', async () => {
    const models = { weaver: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: 'claude-opus-5' } };
    let put: { workers?: { model?: string | null } } | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') { put = JSON.parse(String(init?.body)); return new Response(JSON.stringify(put), { status: 200 }); }
      return new Response(JSON.stringify(models), { status: 200 });
    }) as typeof fetch;
    await buildProgram().parseAsync([...base, 'models', 'set', 'workers', '--model', 'default']);
    expect(put!.workers!.model).toBeNull();
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
