import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensurePushKeys } from '../src/vapid.js';

const tmps: string[] = [];
afterEach(() => { while (tmps.length) { const d = tmps.pop()!; chmodSync(d, 0o700); rmSync(d, { recursive: true, force: true }); } });

function dir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ac-vapid-'));
  tmps.push(d);
  return d;
}

describe('ensurePushKeys', () => {
  it('generates a pair the first time and reuses it on every later call', () => {
    const configDir = dir();
    const first = ensurePushKeys(configDir);
    expect(first).not.toBeNull();
    expect(first!.publicKey).toEqual(expect.any(String));
    expect(first!.privateKey).toEqual(expect.any(String));

    const second = ensurePushKeys(configDir);
    expect(second).toEqual(first);
  });

  it('generates independent pairs for independent config directories', () => {
    const a = ensurePushKeys(dir());
    const b = ensurePushKeys(dir());
    expect(a!.publicKey).not.toEqual(b!.publicKey);
  });

  it('returns null instead of throwing when the store cannot be written', () => {
    const parent = dir();
    const unwritable = join(parent, 'locked');
    mkdirSync(unwritable, { mode: 0o500 });
    chmodSync(unwritable, 0o500);
    expect(ensurePushKeys(unwritable)).toBeNull();
  });
});
