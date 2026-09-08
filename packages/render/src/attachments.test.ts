import { describe, expect, it } from 'vitest';
import { attachmentPartsOf, attachmentToView } from './attachments.js';

describe('attachmentPartsOf', () => {
  it('picks out well-formed attachment parts and drops anything else', () => {
    const parts = [
      { type: 'attachment', id: 'a1', filename: 'shot.png', mediaType: 'image/png', byteSize: 1200 },
      { type: 'something-else' },
      null,
      'not an object',
      { type: 'attachment', id: 'missing-fields' },
    ];
    expect(attachmentPartsOf(parts)).toEqual([{ type: 'attachment', id: 'a1', filename: 'shot.png', mediaType: 'image/png', byteSize: 1200 }]);
  });

  it('returns an empty array for null, undefined or a non-array', () => {
    expect(attachmentPartsOf(null)).toEqual([]);
    expect(attachmentPartsOf(undefined)).toEqual([]);
    expect(attachmentPartsOf('not an array' as unknown as unknown[])).toEqual([]);
  });
});

describe('attachmentToView', () => {
  it('classifies an image, formats its size', () => {
    expect(attachmentToView({ type: 'attachment', id: 'a1', filename: 'shot.png', mediaType: 'image/png', byteSize: 1536 })).toEqual({
      id: 'a1', filename: 'shot.png', mediaType: 'image/png', byteSize: 1536, kind: 'image', sizeLabel: '1.5KB',
    });
  });

  it('classifies a text document', () => {
    expect(attachmentToView({ type: 'attachment', id: 'a2', filename: 'notes.txt', mediaType: 'text/plain', byteSize: 42 }).kind).toBe('text');
  });
});
