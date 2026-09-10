import { OcError, canTransition, TRANSITIONS, type TicketKind, type TicketStatus } from '@agent-conductor/shared';

/** Everything the transition guards need, gathered by the service before it decides (PLAN §6.2). */
export interface GuardFacts {
  /** Blockers that are not `done` (cancelled blockers never satisfy a dependency). */
  openBlockers: number;
  /** The request (or the ticket) names at least one blocker. */
  hasBlockers: boolean;
  /** An open decision is attached to the ticket. */
  hasOpenDecision: boolean;
  /** The request carries `unblock: {owner, action}`. */
  hasUnblockPath: boolean;
  /** A work product (PR, branch, report, …) has been recorded. */
  hasWorkProduct: boolean;
  /** `auto_merge` is on, or a `merge_approval` decision was answered `approve`. */
  mergeApproved: boolean;
}

/**
 * Validate one status transition. Throws a typed OcError; returns nothing on success.
 * The allowed edges live in shared/transitions.ts (single owner); the guards live here.
 */
export function checkTransition(kind: TicketKind, from: TicketStatus, to: TicketStatus, facts: GuardFacts): void {
  if (from === to) throw new OcError('invalid_disposition', `ticket is already ${to}`, { from, to });
  if (!canTransition(kind, from, to)) {
    throw new OcError('invalid_disposition', `a ${kind} ticket cannot move from ${from} to ${to}`, {
      kind,
      from,
      to,
      allowed: TRANSITIONS[kind][from],
    });
  }
  if (to === 'blocked') {
    const routable = (facts.hasBlockers && facts.openBlockers > 0) || facts.hasOpenDecision || facts.hasUnblockPath;
    if (!routable) {
      throw new OcError('missing_action_path', 'blocked requires open blockers, an open decision, or unblock {owner, action}', { from });
    }
  }
  if (to === 'in_review' && !facts.hasWorkProduct) {
    throw new OcError('invalid_disposition', 'in_review requires a work product (record the PR, branch or report first)', { from });
  }
  if (to === 'merging' && !facts.mergeApproved) {
    throw new OcError('merge_not_approved', 'merging requires an approved merge_approval decision or auto_merge', { from });
  }
}

/** `<identifier-lowercase>-<slug>` — the OpenSpec change name bound to a ticket (PLAN §12.1). */
export function openspecChangeName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug ? `${identifier.toLowerCase()}-${slug}` : identifier.toLowerCase();
}
