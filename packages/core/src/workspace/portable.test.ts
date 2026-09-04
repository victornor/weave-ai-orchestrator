import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import YAML from 'yaml';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { exportWorkspace, importTickets, parseTicketFile, stageWorkspaceImport } from './portable.js';
import type { CoreServices } from '../api.js';

function seedTicket(h: TestHarness, over: Record<string, unknown> = {}): string {
  const id = newId();
  const now = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change',
    title: 'Add dark mode', description: 'Tokens, both themes.', status: 'done', priority: 'high', autoMerge: 1,
    assigneeRoleId: h.roleId, openspecChangeName: 'add-dark-mode', createdByKind: 'human', completedAt: now,
    createdAt: now, updatedAt: now, ...over,
  });
  return id;
}

describe('exportWorkspace', () => {
  let h: TestHarness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  function seedFiles(): void {
    writeFileSync(join(h.root, 'workspace.yaml'), 'version: 1\nid: test\nname: Test Workspace\nticketPrefix: TST\nchannels:\n  telegram:\n    token: ${TELEGRAM_TOKEN}\n');
    mkdirSync(join(h.ctx.paths.roles, 'backend'), { recursive: true });
    writeFileSync(join(h.ctx.paths.roles, 'backend', 'role.yaml'), 'id: backend\nname: Backend Engineer\n');
    writeFileSync(join(h.ctx.paths.roles, 'backend', 'CHARTER.md'), '# Backend Engineer\n');
    writeFileSync(join(h.ctx.paths.roles, 'backend', 'scratch.tmp'), 'noise');
    mkdirSync(join(h.ctx.paths.knowledge, 'workspace', 'archive'), { recursive: true });
    writeFileSync(join(h.ctx.paths.knowledge, 'workspace', 'WORKSPACE.md'), '# Test Workspace\n');
    writeFileSync(join(h.ctx.paths.knowledge, 'workspace', 'archive', 'removed.md'), 'archived entry');
    mkdirSync(h.ctx.paths.runs, { recursive: true });
    writeFileSync(join(h.ctx.paths.runs, 'events.jsonl'), '{}\n');
  }

  it('writes workspace.yaml, roles, knowledge and tickets and leaves secrets as ${ENV} references', () => {
    seedFiles();
    seedTicket(h);
    const result = exportWorkspace(h.ctx);

    expect(result.path.startsWith(join(h.root, 'exports'))).toBe(true);
    expect(result).toMatchObject({ workspace: 'test', roles: 1, knowledgeFiles: 1, tickets: 1 });
    expect(readFileSync(join(result.path, 'workspace.yaml'), 'utf8')).toContain('${TELEGRAM_TOKEN}');
    expect(readdirSync(join(result.path, 'roles', 'backend')).sort()).toEqual(['CHARTER.md', 'role.yaml']);
    expect(existsSync(join(result.path, 'knowledge', 'workspace', 'WORKSPACE.md'))).toBe(true);
    expect(existsSync(join(result.path, 'knowledge', 'workspace', 'archive'))).toBe(false);
    for (const forbidden of ['db.sqlite', 'runs', '.agent-conductor', 'workers']) {
      expect(existsSync(join(result.path, forbidden))).toBe(false);
    }
  });

  it('renders each ticket with front-matter, description, comments and documents', () => {
    seedFiles();
    const ticketId = seedTicket(h);
    h.db.insert('ticket_comments', { id: newId(), ticketId, authorKind: 'agent', authorId: 'ag_1', kind: 'report', body: 'shipped it', sourceTrust: 'agent', createdAt: nowIso() });
    const documentId = newId();
    h.db.insert('ticket_documents', { id: documentId, ticketId, key: 'plan', currentRevision: 2 });
    h.db.insert('ticket_document_revisions', { id: newId(), documentId, revision: 2, body: '## Plan\nstep one', authorKind: 'agent', createdAt: nowIso() });

    const out = exportWorkspace(h.ctx).path;
    const text = readFileSync(join(out, 'tickets', 'TST-1.md'), 'utf8');
    const front = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as Record<string, unknown>;
    expect(front).toMatchObject({
      identifier: 'TST-1', title: 'Add dark mode', kind: 'change', status: 'done', priority: 'high',
      project: 'api', role: 'backend', autoMerge: true, openspecChange: 'add-dark-mode',
    });
    expect(text).toContain('Tokens, both themes.');
    expect(text).toContain('shipped it');
    expect(text).toContain('### plan (revision 2)');
    expect(text).toContain('step one');
  });

  it('honours an explicit output directory', () => {
    seedFiles();
    const out = join(h.root, 'elsewhere');
    expect(exportWorkspace(h.ctx, { out }).path).toBe(out);
    expect(existsSync(join(out, 'workspace.yaml'))).toBe(true);
  });
});

describe('parseTicketFile', () => {
  it('reads the front-matter and description and defaults unknown kinds', () => {
    const parsed = parseTicketFile('---\nidentifier: ACME-7\ntitle: Ship it\nkind: nonsense\nstatus: done\npriority: low\n---\n\n# Ship it\n\n## Description\n\nthe body\n\n## Comments\n\n_(none)_\n')!;
    expect(parsed).toMatchObject({ title: 'Ship it', kind: 'task', priority: 'low', description: 'the body' });
    expect(parsed.provenance).toContain('[imported] from ACME-7');
    expect(parsed.provenance).toContain('was done');
  });

  it('rejects a file with no front-matter or no title', () => {
    expect(parseTicketFile('# just markdown')).toBeNull();
    expect(parseTicketFile('---\nidentifier: X-1\n---\n')).toBeNull();
  });
});

describe('stageWorkspaceImport', () => {
  let source: TestHarness;
  let target: TestHarness;
  beforeEach(() => { source = makeHarness(); target = makeHarness(); });
  afterEach(() => { source.cleanup(); target.cleanup(); });

  function fullExport(): string {
    writeFileSync(join(source.root, 'workspace.yaml'), 'version: 1\nid: source\nname: Source\nticketPrefix: SRC\n');
    mkdirSync(join(source.ctx.paths.roles, 'backend'), { recursive: true });
    writeFileSync(join(source.ctx.paths.roles, 'backend', 'role.yaml'), 'id: backend\n');
    writeFileSync(join(source.ctx.paths.roles, 'backend', 'CHARTER.md'), '# charter\n');
    mkdirSync(join(source.ctx.paths.knowledge, 'workspace'), { recursive: true });
    writeFileSync(join(source.ctx.paths.knowledge, 'workspace', 'SHARED.md'), '# shared\n');
    seedTicket(source);
    return exportWorkspace(source.ctx).path;
  }

  it('copies workspace.yaml, roles and knowledge into a fresh directory', () => {
    const out = fullExport();
    const dest = join(target.root, 'imported');
    const staged = stageWorkspaceImport(out, dest);
    expect(staged).toMatchObject({ created: true, roles: 1, knowledgeFiles: 1, workspaceId: 'source' });
    expect(readFileSync(join(dest, 'workspace.yaml'), 'utf8')).toContain('id: source');
    expect(existsSync(join(dest, 'roles', 'backend', 'CHARTER.md'))).toBe(true);
    expect(existsSync(join(dest, 'knowledge', 'workspace', 'SHARED.md'))).toBe(true);
  });

  it('never overwrites an existing workspace.yaml', () => {
    const out = fullExport();
    writeFileSync(join(target.root, 'workspace.yaml'), 'version: 1\nid: keepme\nname: Keep\nticketPrefix: KEP\n');
    const staged = stageWorkspaceImport(out, target.root);
    expect(staged.created).toBe(false);
    expect(readFileSync(join(target.root, 'workspace.yaml'), 'utf8')).toContain('id: keepme');
  });

  it('refuses a directory that is not an export', () => {
    expect(() => stageWorkspaceImport(target.root, join(target.root, 'x'))).toThrow(/not an AgentConductor export/);
  });
});

describe('importTickets', () => {
  let h: TestHarness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  function services(): { svc: CoreServices; create: ReturnType<typeof vi.fn>; comment: ReturnType<typeof vi.fn> } {
    const create = vi.fn((_actor: unknown, input: Record<string, unknown>) => ({ id: `tk_${String(input.title)}` }));
    const comment = vi.fn();
    return { svc: { tickets: { create, comment } } as unknown as CoreServices, create, comment };
  }

  it('creates one backlog ticket per markdown file with an [imported] comment', () => {
    writeFileSync(join(h.root, 'workspace.yaml'), 'version: 1\nid: test\nname: T\nticketPrefix: TST\n');
    seedTicket(h);
    seedTicket(h, { number: 2, identifier: 'TST-2', title: 'Second', kind: 'task', status: 'in_progress', priority: 'low' });
    const out = exportWorkspace(h.ctx).path;

    const { svc, create, comment } = services();
    expect(importTickets(svc, out)).toEqual({ imported: 2, skipped: 0 });
    expect(create.mock.calls.map((c) => (c[1] as { title: string }).title).sort()).toEqual(['Add dark mode', 'Second']);
    // The service decides the status; no status is passed, so a ticket with no role lands in backlog.
    for (const call of create.mock.calls) expect(call[1]).not.toHaveProperty('status');
    expect(String(comment.mock.calls[0]![2])).toContain('[imported] from');
  });

  it('skips unparseable files and an export with no tickets directory', () => {
    const dir = join(h.root, 'pkg');
    mkdirSync(join(dir, 'tickets'), { recursive: true });
    writeFileSync(join(dir, 'tickets', 'broken.md'), 'no front-matter here');
    writeFileSync(join(dir, 'tickets', 'notes.txt'), 'ignored');
    const { svc, create } = services();
    expect(importTickets(svc, dir)).toEqual({ imported: 0, skipped: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(importTickets(svc, join(h.root, 'nothing'))).toEqual({ imported: 0, skipped: 0 });
  });
});
