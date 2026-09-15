/** The changelog kind vocabulary (PLAN §13.6), shared by the changelog and project overview. */
import type { ChangelogKind } from '../api/types';

/** What each kind reads as. */
export const KIND_LABEL: Record<ChangelogKind, string> = {
  filed: 'filed',
  plan_approved: 'plan approved',
  pr_opened: 'PR opened',
  landed: 'landed',
  cancelled: 'cancelled',
  hired: 'hired',
  upgraded: 'upgraded',
};

/** The badge tone that carries each kind. */
export const KIND_TONE: Record<ChangelogKind, 'added' | 'modified' | 'removed' | 'neutral'> = {
  filed: 'neutral',
  plan_approved: 'modified',
  pr_opened: 'modified',
  landed: 'added',
  cancelled: 'removed',
  hired: 'added',
  upgraded: 'neutral',
};
