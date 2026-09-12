import type { Decision } from '@weave-ai/shared';

/**
 * A card carrying a secret input goes to the daemon directly and is never held in any client-side
 * queue of unsent writes (`human-decisions/answer-inputs`) — on every surface that presents
 * decision cards, not only Needs You.
 */
export function decisionCarriesSecret(decision: Pick<Decision, 'inputs'> | null | undefined): boolean {
  return (decision?.inputs ?? []).some((i) => i.type === 'secret');
}
