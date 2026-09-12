/**
 * Turns a refused decision answer into a message in the human's terms, instead of the raw
 * `wrong_status` error (VS-140). Structured `details` come from `decisions.answer()`
 * (`packages/core/src/decisions/service.ts`): `{ status, supersededBy? }`.
 */
import { ApiError } from '../api/client';

export interface StaleAnswerCopy {
  title: string;
  detail: string;
  /** The ticket to send the human to, when the refusal named a decision that replaced this one. */
  ticketId: string | null;
}

interface StaleDetails {
  status?: string;
  supersededBy?: string;
  weaverReviewStatus?: string;
  weaverReviewNote?: string;
}

/** `null` for anything that is not a stale-decision refusal — the caller falls back to `e.message`. */
export function staleAnswerCopy(e: unknown, ticketId: string | null): StaleAnswerCopy | null {
  if (!(e instanceof ApiError)) return null;
  // VS-266 / VS-281: a distinct refusal from `wrong_status` — the decision is still open, held
  // either by a weaver concern or because the weaver has not reviewed it yet. Named here rather
  // than left to the raw error message, and the two are not allowed to read the same.
  if (e.code === 'revision_pending') {
    const details = e.details as StaleDetails | undefined;
    if (details?.weaverReviewStatus === 'unseen') {
      return { title: 'Waiting on the weaver', detail: 'The weaver has not reviewed this yet. It can be approved once they have, or you can override the hold with a reason.', ticketId: null };
    }
    const note = details?.weaverReviewNote;
    return { title: 'Approval is held', detail: note ? `The weaver has concerns: ${note}` : 'The weaver has concerns about this — revise it, or override the hold.', ticketId: null };
  }
  if (e.code !== 'wrong_status') return null;
  const details = (e.details ?? {}) as StaleDetails;
  switch (details.status) {
    case 'superseded':
      return {
        title: 'This changed while you were looking at it',
        detail: 'A newer decision replaced this one. Your answer was not recorded.',
        ticketId: details.supersededBy ? ticketId : null,
      };
    case 'answered':
      return { title: 'Already answered', detail: 'Someone else answered this before your response reached the daemon.', ticketId: null };
    case 'expired':
      return { title: 'This expired', detail: 'It expired before your answer reached the daemon.', ticketId: null };
    case 'withdrawn':
      return { title: 'This was withdrawn', detail: 'It was withdrawn before your answer reached the daemon.', ticketId: null };
    default:
      return null;
  }
}
