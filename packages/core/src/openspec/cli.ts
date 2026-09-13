/**
 * Typed wrapper over the `openspec` binary (PLAN §12.4). We never import the OpenSpec package: the CLI's
 * JSON contract is the only stable surface. Every call names an explicit cwd, passes `--json`, runs with a
 * 30 s timeout and a fixed non-interactive env, and asserts that OpenSpec resolved the root we expect —
 * its root walk can escalate to an ancestor repo, which would silently read/write the wrong project.
 *
 * The exact JSON shapes are documented by OpenSpec itself (`docs/agent-contract.md`, `docs/cli.md` in its
 * repository) but not guaranteed, so every reader here
 * is defensive: unknown or missing fields degrade to null / empty rather than throwing.
 */
import { execa } from 'execa';
import { resolve, join } from 'node:path';
import { realpathSync, existsSync, readdirSync } from 'node:fs';
import { OcError } from '@weave-ai/shared';

/**
 * `openspec/changes/archive/YYYY-MM-DD-<change>` in some checkout. A leaf helper (no service
 * dependencies) so both `openspec/index.ts` and `tickets/archive-before-merge.ts` can use it without
 * importing each other.
 */
export function archivedDirFor(clonePath: string, changeName: string): string | null {
  const dir = join(clonePath, 'openspec', 'changes', 'archive');
  if (!existsSync(dir)) return null;
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${changeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && re.test(e.name)) return e.name;
  return null;
}

export const OPENSPEC_TIMEOUT_MS = 30_000;

/** Non-interactive, telemetry-free, machine-readable. */
export const OPENSPEC_ENV: Record<string, string> = { CI: '1', OPENSPEC_TELEMETRY: '0', OPENSPEC_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };

/** The binary is resolvable per call (tests substitute a fake), then per workspace env, then PATH. */
export function openspecBin(bin?: string): string { return bin ?? process.env.AC_OPENSPEC_BIN ?? 'openspec'; }

export interface OpenSpecCtx {
  /** Directory the command runs in: the primary clone, or a worker's worktree. */
  cwd: string;
  /** Expected repository root; when given, `root.path` in the response must equal it. Defaults to cwd. */
  root?: string;
  bin?: string;
  timeoutMs?: number;
}
export interface RunOptions { root?: string; bin?: string; timeoutMs?: number; allowFailure?: boolean; raw?: boolean }
export interface RunResult { ok: boolean; json: unknown; stdout: string; exitCode: number | null; stderr: string }

const runOpts = (o: OpenSpecCtx, extra: Partial<RunOptions> = {}): RunOptions => ({ root: o.root ?? o.cwd, bin: o.bin, timeoutMs: o.timeoutMs, ...extra });

/**
 * Low-level invocation. Returns the parsed stdout document. A non-zero exit throws unless `allowFailure`
 * is set — some commands (`validate`) exit 1 with a meaningful JSON body.
 */
export async function run(cwd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const bin = openspecBin(opts.bin);
  const argv = opts.raw || args.includes('--json') ? args : [...args, '--json'];
  let exitCode: number | null = null;
  let stdout = '';
  let stderr = '';
  try {
    const r = await execa(bin, argv, {
      cwd,
      timeout: opts.timeoutMs ?? OPENSPEC_TIMEOUT_MS,
      reject: false,
      env: { ...process.env, ...OPENSPEC_ENV },
      all: false,
    });
    if (isEnoent(r)) throw notFound(bin, r);
    exitCode = typeof r.exitCode === 'number' ? r.exitCode : null;
    stdout = String(r.stdout ?? '');
    stderr = String(r.stderr ?? '');
  } catch (e) {
    if (e instanceof OcError) throw e;
    if (isEnoent(e)) throw notFound(bin, e);
    throw new OcError('internal', `openspec ${argv[0] ?? ''} failed: ${e instanceof Error ? e.message : String(e)}`, { bin, argv, cwd });
  }

  const ok = exitCode === 0;
  if (opts.raw) {
    if (!ok && !opts.allowFailure) throw failed(argv, exitCode, stderr, cwd);
    return { ok, json: null, stdout, exitCode, stderr };
  }

  let json: unknown = null;
  let parseError: string | null = null;
  try { json = parseOne(stdout); } catch (e) { parseError = e instanceof Error ? e.message : String(e); }
  if (json !== null) assertRoot(json, opts.root ?? cwd, argv);

  if (!ok) {
    if (opts.allowFailure) return { ok: false, json, stdout, exitCode, stderr };
    throw failed(argv, exitCode, stderr, cwd);
  }
  if (parseError !== null) throw new OcError('internal', `openspec ${argv[0] ?? ''}: ${parseError}`, { argv, cwd, stdout: stdout.slice(0, 500) });
  return { ok: true, json, stdout, exitCode, stderr };
}

function failed(argv: string[], exitCode: number | null, stderr: string, cwd: string): OcError {
  return new OcError('internal', `openspec ${argv.join(' ')} exited ${exitCode ?? '?'}: ${stderr.trim().slice(0, 300)}`, { argv, cwd, exitCode });
}
/**
 * VS-318: state the real condition and the PATH that was searched. A tool merely absent from the
 * daemon's PATH is not "not installed", and saying so sends people to reinstall a working binary.
 */
export function hostToolNotFoundMessage(name: string, bin: string, pathValue: string = process.env['PATH'] ?? ''): string {
  return `the ${name} binary (${bin}) was not found on the daemon's PATH: ${pathValue}`;
}
function notFound(bin: string, e: unknown): OcError {
  return new OcError('openspec_not_found', hostToolNotFoundMessage('openspec', bin), { bin, path: process.env['PATH'] ?? '', detail: e instanceof Error ? e.message : String(e) });
}
function isEnoent(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: unknown }).code;
  if (code === 'ENOENT') return true;
  const msg = (e as { shortMessage?: unknown; message?: unknown }).shortMessage ?? (e as { message?: unknown }).message;
  return typeof msg === 'string' && msg.includes('ENOENT');
}

/** stdout must carry exactly one JSON document; some builds print a banner line before it. */
export function parseOne(stdout: string): unknown {
  const text = stdout.trim();
  if (!text.length) throw new Error('no JSON on stdout');
  try { return JSON.parse(text); } catch { /* fall through to the salvage path */ }
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* unparseable */ }
  }
  throw new Error('stdout is not a single JSON document');
}

/** OpenSpec's root walk can escalate to an ancestor repo; refuse anything that is not the root we asked for. */
export function assertRoot(json: unknown, expected: string, argv: string[] = []): void {
  const root = isRecord(json) ? json.root : undefined;
  const path = isRecord(root) ? root.path : undefined;
  if (typeof path !== 'string' || !path.length) return;
  if (samePath(path, expected)) return;
  throw new OcError('validation', `openspec resolved root ${path}, expected ${expected}`, { got: path, expected, argv });
}
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => { const r = resolve(p).replace(/\/+$/, ''); try { return realpathSync(r); } catch { return r; } };
  return norm(a) === norm(b);
}

// ---------- shapes (defensively parsed) ----------
export interface ArtifactStatus { id: string; status: string; requires: string[] }
export interface ChangeStatus { changeName: string; isPlanningComplete: boolean; artifacts: ArtifactStatus[] }
export interface ChangeListEntry { name: string; completedTasks: number; totalTasks: number; status: string }
export interface SpecListEntry { id: string; title: string | null; path: string | null; requirementCount: number }
export interface SpecRequirement { name: string; text: string; scenarios: unknown[] }
export interface SpecDoc { id: string; title: string | null; overview: string | null; requirementCount: number; requirements: SpecRequirement[]; path: string | null }
export interface ApplyInstructions { state: 'blocked' | 'ready' | 'all_done' | null; progress: { completed: number; total: number } | null; tasks: unknown[]; contextFiles: string[] }
export interface ValidationIssue { level: string; message: string; path?: string }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[] }
export interface ArchiveResult { archivedAs: string | null; specsUpdated: string[]; warnings: string[] }
export interface NewChangeResult { id: string | null; path: string | null; metadataPath: string | null; schema: string | null }

// ---------- commands ----------

/** `openspec new change "<name>" --goal "<goal>" --json` */
export async function newChange(o: OpenSpecCtx, name: string, goal: string): Promise<NewChangeResult> {
  const r = await run(o.cwd, ['new', 'change', name, '--goal', goal], runOpts(o));
  const c = pick(r.json, 'change') ?? r.json;
  return { id: str(get(c, 'id')), path: str(get(c, 'path')), metadataPath: str(get(c, 'metadataPath')), schema: str(get(c, 'schema')) };
}

/** `openspec status --all --json` */
export async function statusAll(o: OpenSpecCtx): Promise<ChangeStatus[]> {
  const r = await run(o.cwd, ['status', '--all'], runOpts(o));
  return arr(get(r.json, 'changes')).map(changeStatus).filter((c): c is ChangeStatus => c !== null);
}

/** `openspec status --change <name> --json` — null when the change is unknown to OpenSpec. */
export async function statusChange(o: OpenSpecCtx, changeName: string): Promise<ChangeStatus | null> {
  const r = await run(o.cwd, ['status', '--change', changeName], runOpts(o, { allowFailure: true }));
  if (r.json === null) return null;
  const list = arr(get(r.json, 'changes'));
  if (list.length) return changeStatus(list.find((c) => str(get(c, 'changeName')) === changeName) ?? list[0]);
  const one = pick(r.json, 'change') ?? r.json;
  const parsed = changeStatus(one);
  return parsed && (parsed.changeName === changeName || parsed.changeName === '') ? { ...parsed, changeName } : parsed;
}

/** `openspec list --json` — cheap batch task counts. */
export async function list(o: OpenSpecCtx): Promise<ChangeListEntry[]> {
  const r = await run(o.cwd, ['list'], runOpts(o));
  const rows = arr(get(r.json, 'changes')).length ? arr(get(r.json, 'changes')) : arr(r.json);
  return rows.map((c) => ({
    name: str(get(c, 'name')) ?? str(get(c, 'changeName')) ?? '',
    completedTasks: num(get(c, 'completedTasks')),
    totalTasks: num(get(c, 'totalTasks')),
    status: str(get(c, 'status')) ?? '',
  })).filter((c) => c.name.length > 0);
}

/** `openspec list --specs --json` — the capability list. */
export async function listSpecs(o: OpenSpecCtx): Promise<SpecListEntry[]> {
  const r = await run(o.cwd, ['list', '--specs'], runOpts(o));
  const rows = firstArray(r.json, ['specs', 'capabilities', 'items']);
  const out: SpecListEntry[] = [];
  for (const row of rows) {
    if (typeof row === 'string') { out.push({ id: row, title: null, path: null, requirementCount: 0 }); continue; }
    const id = str(get(row, 'id')) ?? str(get(row, 'name')) ?? str(get(row, 'capability'));
    if (!id) continue;
    out.push({ id, title: str(get(row, 'title')), path: str(get(row, 'path')), requirementCount: num(get(row, 'requirementCount')) });
  }
  return out;
}

/** `openspec show <id> --type spec --json` */
export async function showSpec(o: OpenSpecCtx, id: string): Promise<SpecDoc> {
  const r = await run(o.cwd, ['show', id, '--type', 'spec'], runOpts(o));
  const d = pick(r.json, 'spec') ?? r.json;
  const requirements = arr(get(d, 'requirements')).map((q) => ({
    name: str(get(q, 'name')) ?? str(get(q, 'id')) ?? '',
    text: str(get(q, 'text')) ?? str(get(q, 'description')) ?? '',
    scenarios: arr(get(q, 'scenarios')),
  }));
  return {
    id: str(get(d, 'id')) ?? id,
    title: str(get(d, 'title')),
    overview: str(get(d, 'overview')),
    requirementCount: num(get(d, 'requirementCount'), requirements.length),
    requirements,
    path: str(get(d, 'path')),
  };
}

/** `openspec instructions apply --change <name> --json` */
export async function instructionsApply(o: OpenSpecCtx, changeName: string): Promise<ApplyInstructions> {
  const r = await run(o.cwd, ['instructions', 'apply', '--change', changeName], runOpts(o, { allowFailure: true }));
  const d = r.json;
  const state = str(get(d, 'state'));
  return {
    state: state === 'blocked' || state === 'ready' || state === 'all_done' ? state : null,
    progress: progressOf(get(d, 'progress')),
    tasks: arr(get(d, 'tasks')),
    contextFiles: arr(get(d, 'contextFiles')).filter((f): f is string => typeof f === 'string'),
  };
}

/** `openspec validate <name> --json --strict` — exit 1 on validation failure, with the issues on stdout. */
export async function validate(o: OpenSpecCtx, changeName: string): Promise<ValidationResult> {
  const r = await run(o.cwd, ['validate', changeName, '--strict'], runOpts(o, { allowFailure: true }));
  const issues: ValidationIssue[] = [];
  const items = firstArray(r.json, ['items', 'results', 'reports']);
  const collect = (raw: unknown): void => {
    for (const i of arr(raw)) {
      const level = str(get(i, 'level')) ?? str(get(i, 'severity')) ?? 'error';
      const message = str(get(i, 'message')) ?? str(get(i, 'text')) ?? '';
      const path = str(get(i, 'path'));
      const issue: ValidationIssue = { level, message };
      if (path) issue.path = path;
      issues.push(issue);
    }
  };
  for (const item of items) collect(get(item, 'issues'));
  collect(get(r.json, 'issues'));
  if (!r.ok && !issues.length) issues.push({ level: 'error', message: r.stderr.trim().slice(0, 300) || `openspec validate exited ${r.exitCode ?? '?'}` });
  return { ok: r.ok && !issues.some((i) => i.level === 'error'), issues };
}

/**
 * `openspec archive <name> --yes --json` — the deterministic structural merge; never the skill form.
 *
 * A rejected archive (e.g. a MODIFIED requirement that would drop a scenario another change already
 * landed, or a retirement whose rebuilt spec still holds content the merge cannot account for) exits
 * non-zero with the real reason on stdout's `status` array and nothing on stderr, so this reads
 * `allowFailure` and extracts the reason from there — `run()`'s default `failed()` would otherwise
 * report an empty message.
 *
 * Each `status[]` item is one of openspec's own diagnostics: `{ severity, code, message, fix? }`.
 * `fix` is the half that says what to do about it (VS-298) — a refusal openspec explains this way is
 * reported as `openspec_archive_blocked`, carrying both `message` and `fix`, rather than the generic
 * `internal` a caller cannot act on. Only a response with no recognizable diagnostic at all (stdout
 * wasn't structured JSON, or the array was empty) falls back to `internal`.
 */
export async function archive(o: OpenSpecCtx, changeName: string): Promise<ArchiveResult> {
  const r = await run(o.cwd, ['archive', changeName, '--yes'], runOpts(o, { allowFailure: true }));
  if (!r.ok) {
    const items = firstArray(r.json, ['status', 'issues', 'items', 'results']);
    const diagnostics = items
      .map((i) => ({ code: str(get(i, 'code')), message: str(get(i, 'message')), fix: str(get(i, 'fix')) }))
      .filter((d): d is { code: string; message: string; fix: string | null } => d.code !== null && d.message !== null);
    if (diagnostics.length) {
      const detail = diagnostics.map((d) => [d.message, d.fix].filter((s): s is string => s !== null && s.length > 0).join(' ')).join('; ');
      throw new OcError('openspec_archive_blocked', `openspec archive ${changeName} blocked: ${detail}`, {
        changeName, openspecCode: diagnostics[0]!.code, fix: diagnostics[0]!.fix, issues: diagnostics,
      });
    }
    const messages = items.map((i) => str(get(i, 'message'))).filter((m): m is string => m !== null && m.length > 0);
    const detail = messages.length ? messages.join('; ') : (r.stderr.trim().slice(0, 300) || `exited ${r.exitCode ?? '?'}`);
    throw new OcError('internal', `openspec archive ${changeName} failed: ${detail}`, { changeName, exitCode: r.exitCode, stderr: r.stderr.slice(0, 300), issues: items });
  }
  const a = pick(r.json, 'archive') ?? r.json;
  return {
    archivedAs: str(get(a, 'archivedAs')),
    specsUpdated: arr(get(a, 'specsUpdated')).filter((s): s is string => typeof s === 'string'),
    warnings: arr(get(a, 'warnings')).map((w) => (typeof w === 'string' ? w : str(get(w, 'message')) ?? JSON.stringify(w))),
  };
}

/** `openspec --version` — plain text, not JSON. */
export async function version(o: OpenSpecCtx): Promise<string | null> {
  const r = await run(o.cwd, ['--version'], runOpts(o, { raw: true, allowFailure: true }));
  const v = r.stdout.trim().split('\n')[0]?.trim();
  return v && v.length ? v : null;
}

// ---------- defensive readers ----------
export function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function get(v: unknown, key: string): unknown { return isRecord(v) ? v[key] : undefined; }
function pick(v: unknown, key: string): unknown { const x = get(v, key); return isRecord(x) ? x : undefined; }
function str(v: unknown): string | null { return typeof v === 'string' && v.length ? v : null; }
function num(v: unknown, dflt = 0): number { return typeof v === 'number' && Number.isFinite(v) ? v : dflt; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function firstArray(v: unknown, keys: string[]): unknown[] {
  if (Array.isArray(v)) return v;
  for (const k of keys) { const x = get(v, k); if (Array.isArray(x)) return x; }
  return [];
}
function progressOf(v: unknown): { completed: number; total: number } | null {
  if (!isRecord(v)) return null;
  const completed = num(v.completed ?? v.completedTasks ?? v.done);
  const total = num(v.total ?? v.totalTasks ?? v.count);
  return total || completed ? { completed, total } : { completed: 0, total: 0 };
}
function changeStatus(c: unknown): ChangeStatus | null {
  if (!isRecord(c)) return null;
  const artifacts = arr(c.artifacts).map((a) => ({
    id: str(get(a, 'id')) ?? '',
    status: str(get(a, 'status')) ?? 'unknown',
    requires: arr(get(a, 'requires')).filter((x): x is string => typeof x === 'string'),
  })).filter((a) => a.id.length > 0);
  const complete = c.isPlanningComplete ?? c.isComplete;
  return { changeName: str(c.changeName) ?? str(c.name) ?? '', isPlanningComplete: complete === true, artifacts };
}
