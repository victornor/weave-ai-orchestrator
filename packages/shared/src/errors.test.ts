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

describe('openspec_archive_blocked (VS-298)', () => {
  it('is a known error code', () => {
    expect(ERROR_CODES).toContain('openspec_archive_blocked');
  });

  it('maps to 422, alongside openspec_validation_failed', () => {
    expect(OcError.status('openspec_archive_blocked')).toBe(422);
    expect(OcError.status('openspec_archive_blocked')).toBe(OcError.status('openspec_validation_failed'));
  });
});

describe('pull_request_draft (VS-889)', () => {
  it('is a known error code', () => {
    expect(ERROR_CODES).toContain('pull_request_draft');
  });

  it('maps to 422, alongside worktree_not_landed', () => {
    expect(OcError.status('pull_request_draft')).toBe(422);
    expect(OcError.status('pull_request_draft')).toBe(OcError.status('worktree_not_landed'));
  });
});
