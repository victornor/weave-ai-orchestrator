import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OcError } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { writeFakeOpenspec } from './fakeBin.js';
import * as cli from './cli.js';

let h: TestHarness | null = null;
afterEach(() => { h?.cleanup(); h = null; });

function setup(cases: Parameters<typeof writeFakeOpenspec>[1]): { clone: string; bin: ReturnType<typeof writeFakeOpenspec> } {
  h = makeHarness();
  const clone = join(h.root, 'projects', 'api');
  mkdirSync(clone, { recursive: true });
  return { clone, bin: writeFakeOpenspec(join(h.root, 'fake-openspec'), cases) };
}

describe('openspec cli wrapper', () => {
  it('builds argv, sets the non-interactive env and parses status --all', async () => {
    const { clone, bin } = setup([
      { match: ['status', '--all'], json: { changes: [{ changeName: 'tst-1-dark-mode', isPlanningComplete: true, artifacts: [{ id: 'proposal', status: 'done', requires: [] }, { id: 'tasks', status: 'ready', requires: ['proposal'] }] }] } },
    ]);
    const out = await cli.statusAll({ cwd: clone, bin: bin.path });
    expect(out).toEqual([{ changeName: 'tst-1-dark-mode', isPlanningComplete: true, artifacts: [{ id: 'proposal', status: 'done', requires: [] }, { id: 'tasks', status: 'ready', requires: ['proposal'] }] }]);
    const call = bin.calls()[0]!;
    expect(call.argv).toEqual(['status', '--all', '--json']);
    expect(call.cwd).toBe(clone);
    expect(call.env).toEqual({ CI: '1', NO_COLOR: '1', OPENSPEC_TELEMETRY: '0', OPENSPEC_NO_UPDATE_CHECK: '1' });
  });

  it('rejects a response whose root escaped to an ancestor repo', async () => {
    const { clone, bin } = setup([{ match: ['status', '--all'], json: { changes: [] }, root: '/some/ancestor/repo' }]);
    await expect(cli.statusAll({ cwd: clone, bin: bin.path })).rejects.toMatchObject({ code: 'validation' });
  });

  it('accepts a root.path equal to the expected root', async () => {
    // the fake echoes its own cwd as root.path, which is the clone.
    const { clone, bin } = setup([{ match: ['list'], json: { changes: [{ name: 'a', completedTasks: 1, totalTasks: 3, status: 'in-progress' }] } }]);
    await expect(cli.list({ cwd: clone, root: clone, bin: bin.path })).resolves.toEqual([{ name: 'a', completedTasks: 1, totalTasks: 3, status: 'in-progress' }]);
  });

  it('maps a missing binary to openspec_not_found', async () => {
    const { clone } = setup([]);
    const err = await cli.statusAll({ cwd: clone, bin: join(clone, 'definitely-not-installed') }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcError);
    expect((err as OcError).code).toBe('openspec_not_found');
  });

  it('returns issues from validate even though it exits 1', async () => {
    const { clone, bin } = setup([
      { match: ['validate'], exit: 1, json: { items: [{ issues: [{ level: 'error', message: 'no spec deltas', path: 'specs/' }, { level: 'warning', message: 'short proposal' }] }] } },
    ]);
    const r = await cli.validate({ cwd: clone, bin: bin.path }, 'tst-1-dark-mode');
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ level: 'error', message: 'no spec deltas', path: 'specs/' }, { level: 'warning', message: 'short proposal' }]);
    expect(bin.calls()[0]!.argv).toEqual(['validate', 'tst-1-dark-mode', '--strict', '--json']);
  });

  it('treats a clean validate as ok', async () => {
    const { clone, bin } = setup([{ match: ['validate'], json: { items: [{ issues: [] }] } }]);
    await expect(cli.validate({ cwd: clone, bin: bin.path }, 'c')).resolves.toEqual({ ok: true, issues: [] });
  });

  it('parses instructions apply, archive, show and new change', async () => {
    const { clone, bin } = setup([
      { match: ['instructions', 'apply'], json: { state: 'ready', progress: { completed: 2, total: 5 }, tasks: [{ text: 'do it' }], contextFiles: ['openspec/changes/c/tasks.md'] } },
      { match: ['archive'], json: { archive: { archivedAs: '2026-09-04-c', specsUpdated: ['auth'], warnings: [] } } },
      { match: ['show'], json: { id: 'auth', title: 'Auth', overview: 'ov', requirementCount: 1, requirements: [{ name: 'R1', text: 'must', scenarios: [{ name: 's' }] }] } },
      { match: ['new', 'change'], json: { change: { id: 'tst-1-x', path: 'openspec/changes/tst-1-x', metadataPath: 'openspec/changes/tst-1-x/.openspec.yaml', schema: 'spec-driven' } } },
    ]);
    const o = { cwd: clone, bin: bin.path };
    expect(await cli.instructionsApply(o, 'c')).toEqual({ state: 'ready', progress: { completed: 2, total: 5 }, tasks: [{ text: 'do it' }], contextFiles: ['openspec/changes/c/tasks.md'] });
    expect(await cli.archive(o, 'c')).toEqual({ archivedAs: '2026-09-04-c', specsUpdated: ['auth'], warnings: [] });
    expect(await cli.showSpec(o, 'auth')).toEqual({ id: 'auth', title: 'Auth', overview: 'ov', requirementCount: 1, requirements: [{ name: 'R1', text: 'must', scenarios: [{ name: 's' }] }], path: null });
    expect(await cli.newChange(o, 'tst-1-x', 'goal')).toMatchObject({ id: 'tst-1-x', schema: 'spec-driven' });
    expect(bin.calls().at(-1)!.argv).toEqual(['new', 'change', 'tst-1-x', '--goal', 'goal', '--json']);
  });

  it('surfaces the real reason and the code when archive rejects a change, even with nothing on stderr', async () => {
    const { clone, bin } = setup([
      { match: ['archive'], exit: 1, json: { archive: null, status: [{ severity: 'error', code: 'archive_spec_update_failed', message: 'conductor-chat/turn-work-trace MODIFIED failed: omits scenario(s) the current spec still has: "A scenario"', fix: 'Fix the change delta specs and rerun. No files were changed.' }] } },
    ]);
    const err = await cli.archive({ cwd: clone, bin: bin.path }, 'c').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcError);
    expect((err as OcError).code).toBe('openspec_archive_blocked');
    expect((err as OcError).message).toContain('omits scenario(s) the current spec still has');
    expect((err as OcError).message).not.toMatch(/failed: *$/);
  });

  it('surfaces a retirement refusal\'s fix guidance, not only its headline message (VS-298)', async () => {
    // The exact diagnostic shape the installed @fission-ai/openspec@1.12.0 prints for a declared
    // retirement whose rebuilt spec still holds content the merge cannot account for.
    const { clone, bin } = setup([
      { match: ['archive'], exit: 1, json: { archive: null, status: [{
        severity: 'error',
        code: 'archive_spec_validation_failed',
        message: "Rebuilt spec for 'runtime-credentials/serialized-refresh' failed validation. No files were changed.",
        fix: "'runtime-credentials/serialized-refresh' declares retire_capabilities, but the spec holds content the merge cannot safely account for and deleting the file would take with it: \"runtime's credential needs refreshing\". Move it into `## Purpose` or a canonical requirement, or delete the spec by hand.",
      }] } },
    ]);
    const err = await cli.archive({ cwd: clone, bin: bin.path }, 'c').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcError);
    const oc = err as OcError;
    expect(oc.code).toBe('openspec_archive_blocked');
    expect(oc.retryable).toBe(false);
    expect(oc.message).toContain("Rebuilt spec for 'runtime-credentials/serialized-refresh' failed validation");
    expect(oc.message).toContain('declares retire_capabilities, but the spec holds content the merge cannot safely account for');
    expect(oc.details).toMatchObject({ openspecCode: 'archive_spec_validation_failed' });
    expect((oc.details as { fix: string }).fix).toContain('Move it into `## Purpose` or a canonical requirement, or delete the spec by hand.');
  });

  it('falls back to stderr when archive rejects with no structured issues', async () => {
    const { clone, bin } = setup([{ match: ['archive'], exit: 1, stdout: '', json: undefined }]);
    // the fake writes nothing to stderr either in this case; assert the message still names the exit code rather than being empty.
    const err = await cli.archive({ cwd: clone, bin: bin.path }, 'c').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcError);
    expect((err as OcError).message.length).toBeGreaterThan('openspec archive c failed: '.length);
  });

  it('normalises list --specs entries given as strings or objects', async () => {
    const { clone, bin } = setup([
      { match: ['list', '--specs'], json: { specs: ['auth', { id: 'billing', title: 'Billing', path: 'openspec/specs/billing/spec.md', requirementCount: 4 }] } },
    ]);
    await expect(cli.listSpecs({ cwd: clone, bin: bin.path })).resolves.toEqual([
      { id: 'auth', title: null, path: null, requirementCount: 0 },
      { id: 'billing', title: 'Billing', path: 'openspec/specs/billing/spec.md', requirementCount: 4 },
    ]);
  });

  it('reads --version as raw text without --json', async () => {
    const { clone, bin } = setup([{ match: ['--version'], stdout: '1.12.0\n' }]);
    await expect(cli.version({ cwd: clone, bin: bin.path })).resolves.toBe('1.12.0');
    expect(bin.calls()[0]!.argv).toEqual(['--version']);
  });

  it('throws internal when stdout is not a single JSON document', async () => {
    const { clone, bin } = setup([{ match: ['status', '--all'], stdout: 'not json at all' }]);
    await expect(cli.statusAll({ cwd: clone, bin: bin.path })).rejects.toMatchObject({ code: 'internal' });
  });

  it('salvages a JSON document printed after a banner line', () => {
    expect(cli.parseOne('update available!\n{"a":1}\n')).toEqual({ a: 1 });
  });
});
