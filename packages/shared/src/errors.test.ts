import { describe, expect, it } from 'vitest';
import { ERROR_CODES, OcError } from './errors.js';

describe('revision_pending (VS-266)', () => {
  it('is a known error code', () => {
    expect(ERROR_CODES).toContain('revision_pending');
  });

  it('maps to 409, alongside wrong_status', () => {
    expect(OcError.status('revision_pending')).toBe(409);
    expect(OcError.status('revision_pending')).toBe(OcError.status('wrong_status'));
  });
});
