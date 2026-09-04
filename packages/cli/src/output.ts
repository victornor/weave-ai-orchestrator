/** Printing: `--json` on every command, aligned tables otherwise, typed errors always. */
import chalk from 'chalk';
import { ApiError } from './api.js';

export interface OutputOptions { json: boolean; color: boolean }

let options: OutputOptions = { json: false, color: process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined };

export function configureOutput(next: Partial<OutputOptions>): void {
  options = { ...options, ...next };
  chalk.level = options.color ? (chalk.level > 0 ? chalk.level : 1) : 0;
}

export function outputOptions(): OutputOptions { return options; }
export function isJson(): boolean { return options.json; }

export function write(line = ''): void { process.stdout.write(`${line}\n`); }
export function writeErr(line = ''): void { process.stderr.write(`${line}\n`); }

/** Every command ends here: `--json` prints the payload, otherwise the human renderer runs. */
export function emit(data: unknown, human: () => void): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(data ?? null, null, 2)}\n`);
    return;
  }
  human();
}

export const style = {
  dim: (s: string) => (options.color ? chalk.dim(s) : s),
  bold: (s: string) => (options.color ? chalk.bold(s) : s),
  accent: (s: string) => (options.color ? chalk.hex('#7C87F0')(s) : s),
  ok: (s: string) => (options.color ? chalk.green(s) : s),
  warn: (s: string) => (options.color ? chalk.yellow(s) : s),
  bad: (s: string) => (options.color ? chalk.red(s) : s),
  mono: (s: string) => (options.color ? chalk.cyan(s) : s),
  color: (hex: string, s: string) => (options.color ? chalk.hex(hex)(s) : s),
};

export interface Column<T> { header: string; get: (row: T) => string; align?: 'left' | 'right' }

/** Dense, scan-friendly table. Widths come from the content; nothing is truncated silently. */
export function table<T>(rows: readonly T[], columns: ReadonlyArray<Column<T>>, opts: { empty?: string } = {}): void {
  if (rows.length === 0) {
    write(style.dim(opts.empty ?? 'nothing to show'));
    return;
  }
  const cells = rows.map((row) => columns.map((c) => sanitize(c.get(row))));
  const widths = columns.map((c, i) => Math.max(visibleWidth(c.header), ...cells.map((r) => visibleWidth(r[i] ?? ''))));
  const header = columns.map((c, i) => pad(c.header, widths[i]!, c.align)).join('  ');
  write(style.dim(header.trimEnd()));
  for (const row of cells) {
    write(row.map((cell, i) => pad(cell, widths[i]!, columns[i]!.align)).join('  ').trimEnd());
  }
}

/** Key/value block used by every `show` command. */
export function fields(pairs: ReadonlyArray<[string, string | null | undefined]>): void {
  const visible = pairs.filter((p): p is [string, string] => p[1] !== null && p[1] !== undefined && p[1] !== '');
  if (visible.length === 0) return;
  const width = Math.max(...visible.map(([k]) => k.length));
  for (const [k, v] of visible) {
    const [first, ...rest] = String(v).split('\n');
    write(`${style.dim(k.padEnd(width))}  ${first ?? ''}`);
    for (const line of rest) write(`${' '.repeat(width)}  ${line}`);
  }
}

export function heading(text: string): void {
  write(style.bold(text));
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = Math.max(0, width - visibleWidth(text));
  return align === 'right' ? `${' '.repeat(gap)}${text}` : `${text}${' '.repeat(gap)}`;
}

// Ignore ANSI when measuring so coloured cells still line up.
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
function visibleWidth(text: string): number { return text.replace(ANSI, '').length; }
function sanitize(text: string | null | undefined): string { return (text ?? '').replace(/[\r\n\t]+/g, ' '); }

/** Typed error printing: `error: RUNTIME_UNREACHABLE  <one sentence>` plus a next step. */
export function printError(error: unknown): number {
  if (options.json) {
    const payload = error instanceof ApiError
      ? { error: { code: error.code, message: error.message, status: error.status, details: error.details, retryable: error.retryable } }
      : { error: { code: 'internal', message: (error as Error)?.message ?? String(error), retryable: false } };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return exitCodeFor(error);
  }
  if (error instanceof ApiError) {
    writeErr(`${style.bad('error:')} ${style.bold(String(error.code).toUpperCase())}  ${error.message}`);
    for (const action of nextSteps(error)) writeErr(style.dim(`  -> ${action}`));
    if (error.details && Object.keys(error.details).length > 0) writeErr(style.dim(`  details: ${JSON.stringify(error.details)}`));
  } else {
    writeErr(`${style.bad('error:')} ${(error as Error)?.message ?? String(error)}`);
  }
  return exitCodeFor(error);
}

function nextSteps(error: ApiError): string[] {
  switch (error.code) {
    case 'net_daemon_unreachable': return ['start it with `oc daemon start`, or point at another one with `oc login <url>`'];
    case 'unauthorized':
    case 'auth_session_expired': return ['sign in again with `oc login <url>`'];
    case 'auth_totp_required': return ['pass the six-digit code when prompted'];
    case 'auth_locked': return ['wait for the lockout to expire, then try again'];
    case 'runtime_unreachable': return ['check the runtime with `oc runtime detect`', 'or switch runtime with `oc role set-runtime <role> <runtime>`'];
    case 'not_found': return ['list what exists with the matching `oc ... list` command'];
    case 'worktree_dirty': return ['inspect it with `oc worktree verify <id>`'];
    case 'merge_not_approved': return ['approve the merge decision with `oc decision list`'];
    default: return error.retryable ? ['retryable: try again'] : [];
  }
}

function exitCodeFor(error: unknown): number {
  if (!(error instanceof ApiError)) return 1;
  if (error.code === 'net_daemon_unreachable') return 4;
  if (error.status === 401 || error.status === 403) return 3;
  if (error.status === 404) return 5;
  return 1;
}
