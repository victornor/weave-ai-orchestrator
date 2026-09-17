import { describe, expect, it } from 'vitest';
import { validateArtifactImageDataUris } from './artifactImages.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAAAAAAAAAAAAAAAAAAAAAAAAElFTkSuQmCC';

describe('artifact image data URI validation', () => {
  it('accepts a complete PNG and rejects the real truncated shapes', () => {
    expect(() => validateArtifactImageDataUris(`<html><img src="data:image/png;base64,${png}"></html>`)).not.toThrow();
    expect(() => validateArtifactImageDataUris(`<html><img src="data:image/png;base64,${png.slice(0, -4)}"></html>`)).toThrow(/embedded image #1/);
    expect(() => validateArtifactImageDataUris(`<html><img src="data:image/png;base64,${'a'.repeat(7633)}"></html>`)).toThrow(/embedded image #1/);
  });

  it('rejects a valid signature with incomplete PNG chunks', () => {
    const signature = 'iVBORw0KGgo=';
    expect(() => validateArtifactImageDataUris(`<html><img src="data:image/png;base64,${signature}"></html>`)).toThrow(/malformed or incomplete/);
  });
});
