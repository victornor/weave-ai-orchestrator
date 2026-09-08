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
}

/** `null` for anything that is not a stale-decision refusal — the caller falls back to `e.message`. */
export function staleAnswerCopy(e: unknown, ticketId: string | null): StaleAnswerCopy | null {
  if (!(e instanceof ApiError) || e.code !== 'wrong_status') return null;
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
