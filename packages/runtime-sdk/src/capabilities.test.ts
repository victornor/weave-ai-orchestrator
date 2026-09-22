import { describe, expect, it } from 'vitest';
import { FakeRuntime } from './testkit.js';

/**
 * VS-659: the image-input capability's default is the safe `path` form, so a runtime that declares
 * nothing never has an image silently dropped.
 */
describe('imageInput capability', () => {
  it('defaults a runtime that declares nothing to path', () => {
    expect(new FakeRuntime().capabilities.imageInput).toBe('path');
  });

  it('reports a declared form', () => {
    const rt = new FakeRuntime();
    rt.imageInput = 'native';
    expect(rt.capabilities.imageInput).toBe('native');
  });
});