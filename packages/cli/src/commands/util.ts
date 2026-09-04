/** Shared plumbing for the command modules. */
import type { Command } from 'commander';
import { printError } from '../output.js';
import { resolveSession, type GlobalOptions, type ResolveOptions, type Session } from '../resolve.js';

/** Wrap a command body: typed errors are printed, the exit code comes from the error. */
export async function run(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (error) {
    process.exitCode = printError(error);
  }
}

export function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

export function session(command: Command, options: ResolveOptions = {}): Promise<Session> {
  return resolveSession(globals(command), options);
}

/** Comma-separated list flag. */
export function list(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

/** Servers may return `{items,total}`, a bare array, or `{tickets:[...]}`; accept all three. */
export function items<T>(payload: unknown, key?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record['items'])) return record['items'] as T[];
    if (key && Array.isArray(record[key])) return record[key] as T[];
    for (const value of Object.values(record)) if (Array.isArray(value)) return value as T[];
  }
  return [];
}

/** Responses may wrap the entity (`{ ticket: {...}, comments: [...] }`) or be the entity itself. */
export function unwrap<T>(payload: unknown, key: string): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const inner = (payload as Record<string, unknown>)[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as T;
  }
  return payload as T;
}

export function first<T>(value: T[] | undefined): T | null {
  return value && value.length > 0 ? value[0]! : null;
}
