import { beforeEach, describe, expect, it } from 'vitest';
import { isDynamicImportError, markChunkReload, shouldReloadForChunkError } from '../lib/chunkReload';

beforeEach(() => sessionStorage.clear());

describe('isDynamicImportError', () => {
  it('matches the Chromium/Vite wording', () => {
    expect(isDynamicImportError(new Error('Failed to fetch dynamically imported module: https://x/assets/Foo-abc.js'))).toBe(true);
  });

  it('matches the Firefox and Safari wordings too', () => {
    expect(isDynamicImportError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isDynamicImportError(new Error('Importing a module script failed'))).toBe(true);
  });

  it('is not fooled by an unrelated error', () => {
    expect(isDynamicImportError(new Error('Network request failed'))).toBe(false);
    expect(isDynamicImportError(new TypeError("Cannot read properties of undefined (reading 'foo')"))).toBe(false);
  });

  it('handles a thrown non-Error the same way', () => {
    expect(isDynamicImportError('Failed to fetch dynamically imported module')).toBe(true);
    expect(isDynamicImportError('boom')).toBe(false);
  });
});

describe('shouldReloadForChunkError / markChunkReload', () => {
  it('says yes the first time, with nothing marked yet', () => {
    expect(shouldReloadForChunkError()).toBe(true);
  });

  it('says no right after a reload was marked — a loop, not a fresh failure', () => {
    markChunkReload(1_000_000);
    expect(shouldReloadForChunkError(1_000_500)).toBe(false);
  });

  it('says yes again once enough time has passed — a later, independent upgrade', () => {
    markChunkReload(1_000_000);
    expect(shouldReloadForChunkError(1_000_000 + 20_000)).toBe(true);
  });
});
