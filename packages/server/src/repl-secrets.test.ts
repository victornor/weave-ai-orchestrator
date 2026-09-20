import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openWorkspaceSecret } from '@weave-ai/agent';
import { createSecretStore } from '@weave-ai/core';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ws-repl-secret-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the REPL\'s read-only secret opener', () => {
  it('opens what the daemon\'s own store wrote, and nothing it did not', () => {
    const store = createSecretStore({ secretsFile: join(dir, 'secrets.enc'), secretsKey: join(dir, 'secrets.key') });
    store.put('WEAVE_LLM_LOCAL_KEY', 'sk-from-the-daemon');
    expect(openWorkspaceSecret(dir, 'WEAVE_LLM_LOCAL_KEY')).toBe('sk-from-the-daemon');
    expect(openWorkspaceSecret(dir, 'OTHER')).toBeNull();
    expect(openWorkspaceSecret(join(dir, 'missing'), 'WEAVE_LLM_LOCAL_KEY')).toBeNull();
  });
});
