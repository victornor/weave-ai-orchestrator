import { describe, expect, it } from 'vitest';
import { PROMOTION_REVIEW_STALE_LINE } from '@weave-ai/shared';
import { ApiError } from '../api/client';
import { staleAnswerCopy } from './decisionStaleness';

describe('staleAnswerCopy', () => {
  it('names the concern when a decision is held (VS-266)', () => {
    const e = new ApiError(409, { code: 'revision_pending', message: 'held', details: { weaverReviewStatus: 'concerns', weaverReviewNote: 'the migration needs splitting' } });
    expect(staleAnswerCopy(e, null)).toEqual({
      title: 'Approval is held',
      detail: 'The weaver has concerns: the migration needs splitting',
      ticketId: null,
    });
  });

  it('names the pending review when a decision is unreviewed (VS-281)', () => {
    const e = new ApiError(409, { code: 'revision_pending', message: 'held', details: { weaverReviewStatus: 'unseen' } });
    expect(staleAnswerCopy(e, null)).toEqual({
      title: 'Waiting on the weaver',
      detail: 'The weaver has not reviewed this yet. It can be approved once they have, or you can override the hold with a reason.',
      ticketId: null,
    });
  });

  it('does not read an unreviewed hold as a concern', () => {
    const unseen = new ApiError(409, { code: 'revision_pending', message: 'held', details: { weaverReviewStatus: 'unseen' } });
    const concerns = new ApiError(409, { code: 'revision_pending', message: 'held', details: { weaverReviewStatus: 'concerns', weaverReviewNote: 'x' } });
    expect(staleAnswerCopy(unseen, null)?.title).not.toBe(staleAnswerCopy(concerns, null)?.title);
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

  it('names a moved promotion head with the card\'s own line (VS-632)', () => {
    const e = new ApiError(409, {
      code: 'revision_pending',
      message: 'held',
      details: { weaverReviewHeadMismatch: true, weaverReviewedHeadSha: '8d2051f1', landingHead: 'c17384f9' },
    });
    expect(staleAnswerCopy(e, null)).toEqual({
      title: 'Approval is held',
      detail: PROMOTION_REVIEW_STALE_LINE,
      ticketId: null,
    });
  });

  it('does not read the moved-head refusal as a concern', () => {
    const moved = new ApiError(409, { code: 'revision_pending', message: 'held', details: { weaverReviewHeadMismatch: true } });
    const concerns = new ApiError(409, { code: 'revision_pending', message: 'held', details: { weaverReviewStatus: 'concerns', weaverReviewNote: 'x' } });
    expect(staleAnswerCopy(moved, null)?.detail).not.toBe(staleAnswerCopy(concerns, null)?.detail);
  });

  it('returns null for anything else', () => {
    expect(staleAnswerCopy(new Error('boom'), null)).toBeNull();
    expect(staleAnswerCopy(new ApiError(400, { code: 'validation', message: 'bad' }), null)).toBeNull();
  });
});
