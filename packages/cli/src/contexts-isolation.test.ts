/**
 * VS-399: the vitest setup must point the CLI's contexts file at a throwaway path, so no test can
 * write the host's `~/.config/weave/contexts.yaml` and repoint every bare `weave` command at a test
 * daemon — the 2026-09-14 VS-378 scratch `weave login` did exactly that to captain's host.
 *
 * This file deliberately sets no env of its own: it reads what `vitest.setup.ts` left behind.
 */
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contextsPath } from './contexts.js';

describe('suite contexts isolation (VS-399)', () => {
  it('resolves the contexts file under a temp dir, never the host config home', () => {
    const path = resolve(contextsPath());
    const root = resolve(tmpdir());
    expect(path === root || path.startsWith(`${root}/`)).toBe(true);
    expect(path).not.toContain('/.config/');
  });
});
