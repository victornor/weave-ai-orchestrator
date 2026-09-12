import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { HandleStore, StoredHandle } from './types.js';

export function defaultHandleStorePath(workspaceId: string, presenterId: string): string {
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9_.-]+/g, '-');
  return join(stateHome, 'weave', 'presenter', `${safe(workspaceId)}-${safe(presenterId)}.json`);
}

/** Handles live on the client: the presenter reloads them from disk and re-verifies each. */
export function createFileHandleStore(path: string): HandleStore {
  return {
    async load(): Promise<StoredHandle[]> {
      try {
        const raw = await readFile(path, 'utf8');
        const parsed = JSON.parse(raw) as { handles?: StoredHandle[] };
        return Array.isArray(parsed.handles) ? parsed.handles : [];
      } catch {
        return [];
      }
    },
    async save(handles: StoredHandle[]): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify({ handles }, null, 2)}\n`, 'utf8');
    },
  };
}

export function createMemoryHandleStore(initial: StoredHandle[] = []): HandleStore & { current(): StoredHandle[] } {
  let state = initial;
  return {
    async load() { return state; },
    async save(handles) { state = handles; },
    current: () => state,
  };
}
