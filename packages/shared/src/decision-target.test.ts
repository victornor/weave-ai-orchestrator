import { describe, expect, it } from 'vitest';
import { documentTarget } from './decision-target.js';

describe('documentTarget (VS-224)', () => {
  it('parses the shape plan and action approvals write', () => {
    expect(documentTarget({ target: { documentId: 'doc_1', revision: 2 } })).toEqual({ documentId: 'doc_1', revision: 2 });
  });

  it('parses a revision-less reference', () => {
    expect(documentTarget({ target: { documentId: 'doc_1' } })).toEqual({ documentId: 'doc_1' });
  });

  it('returns null for everything that is not a reference', () => {
    expect(documentTarget({ target: null })).toBeNull();
    expect(documentTarget({ target: {} })).toBeNull();
    expect(documentTarget({ target: { documentId: '' } })).toBeNull();
    expect(documentTarget({ target: { documentId: '   ' } })).toBeNull();
    expect(documentTarget({ target: { documentId: 7 } })).toBeNull();
    expect(documentTarget({ target: { documentId: 'doc_1', revision: '2' } })).toBeNull();
    expect(documentTarget({ target: { documentId: 'doc_1', revision: Number.NaN } })).toBeNull();
    expect(documentTarget({ target: { documentId: 'doc_1', revision: null } })).toBeNull();
  });

  it('ignores unrelated target fields around the reference', () => {
    expect(documentTarget({ target: { prUrl: 'https://x', documentId: 'doc_2', revision: 1, ci: {} } })).toEqual({
      documentId: 'doc_2',
      revision: 1,
    });
  });
});
