import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { staleAnswerCopy } from './decisionStaleness';

describe('staleAnswerCopy', () => {
  it('names the concern when a decision is held (VS-266)', () => {
    const e = new ApiError(409, { code: 'revision_pending', message: 'held', details: { conductorReviewNote: 'the migration needs splitting' } });
    expect(staleAnswerCopy(e, null)).toEqual({
      title: 'Approval is held',
      detail: 'The conductor has concerns: the migration needs splitting',
      ticketId: null,
    });
  });

  it('falls back to a generic detail when the hold carries no note', () => {
    const e = new ApiError(409, { code: 'revision_pending', message: 'held', details: {} });
    expect(staleAnswerCopy(e, null)?.title).toBe('Approval is held');
  });

  it('is distinct from a stale wrong_status refusal', () => {
    const revisionPending = new ApiError(409, { code: 'revision_pending', message: 'held', details: {} });
    const wrongStatus = new ApiError(409, { code: 'wrong_status', message: 'stale', details: { status: 'answered' } });
    expect(staleAnswerCopy(revisionPending, null)?.title).not.toBe(staleAnswerCopy(wrongStatus, null)?.title);
  });

  it('returns null for anything else', () => {
    expect(staleAnswerCopy(new Error('boom'), null)).toBeNull();
    expect(staleAnswerCopy(new ApiError(400, { code: 'validation', message: 'bad' }), null)).toBeNull();
  });
});
