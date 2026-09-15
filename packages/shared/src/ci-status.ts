/**
 * VS-481: the compact CI chip a merge-approval card shows, derived purely from the check state the
 * daemon already recorded on the ticket's delivery. One derivation so the V2 card, the ticket page and
 * `decisionToCard` all agree, and so "every check skipped is not a pass" lives in exactly one place.
 */
/** A check's own state, structurally the forge's `ForgeCheckState` (shared imports nothing from the SDKs). */
export type CiCheckState = 'pending' | 'success' | 'failure' | 'none';

export interface CiCheck {
  name: string;
  state: CiCheckState;
}

export type CiChipTone = 'pending' | 'passed' | 'failed' | 'skipped' | 'stale';

export interface CiChip {
  tone: CiChipTone;
  /** The compact chip text, e.g. `Waiting for CI · 2/4`, `CI failed · lint`. */
  line: string;
  /** The checks to name on hover/expand — the pending or failed ones, in the rollup's order. */
  checks: string[];
}

/** What the delivery JSON carries, read defensively: every field is written by the supervisor. */
type Delivery = Record<string, unknown> | null | undefined;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function checksOf(v: unknown): CiCheck[] {
  if (!Array.isArray(v)) return [];
  const out: CiCheck[] = [];
  for (const raw of v) {
    const c = asRecord(raw);
    if (!c || typeof c.name !== 'string') continue;
    const state = c.state;
    if (state !== 'pending' && state !== 'success' && state !== 'failure' && state !== 'none') continue;
    out.push({ name: c.name, state });
  }
  return out;
}

/**
 * Derive the chip from a ticket's delivery, or `null` when there is nothing to say (no pull request
 * yet, a merged/closed pull request, no recorded rollup, or a forge that reported no checks at all).
 *
 * `approvedHead` is the head the card is approving; it defaults to the delivery's recorded
 * `prHead`. When the recorded rollup describes a different head (`ciHead`), the chip is `stale`
 * rather than a tally — a pass on another commit must never read as a pass on this one.
 */
export function ciChipCopy(delivery: Delivery, opts: { approvedHead?: string | null } = {}): CiChip | null {
  const d = asRecord(delivery);
  if (!d) return null;
  const prState = d.prState;
  if (prState === 'merged' || prState === 'closed') return null;

  const ciState = d.ciState;
  if (ciState !== 'pending' && ciState !== 'success' && ciState !== 'failure' && ciState !== 'none') return null;

  const ciHead = typeof d.ciHead === 'string' && d.ciHead ? d.ciHead : null;
  const approvedHead = opts.approvedHead !== undefined
    ? opts.approvedHead
    : (typeof d.prHead === 'string' && d.prHead ? d.prHead : null);
  if (ciHead && approvedHead && ciHead !== approvedHead) {
    return { tone: 'stale', line: 'CI on an older commit', checks: [] };
  }

  const tally = asRecord(d.prChecks);
  const passed = typeof tally?.['passed'] === 'number' ? (tally['passed'] as number) : null;
  const total = typeof tally?.['total'] === 'number' ? (tally['total'] as number) : null;
  const checks = checksOf(d.ciChecks);

  if (ciState === 'none') {
    // No tally at all means the forge reported no checks. A tally with no real entries means every
    // reported check was skipped — VS-466's "not a pass", which the card must say plainly.
    if (total === null || total === 0) return null;
    return { tone: 'skipped', line: 'CI skipped', checks: [] };
  }
  if (ciState === 'success') return { tone: 'passed', line: 'CI passed', checks: [] };
  if (ciState === 'failure') {
    const failed = checks.filter((c) => c.state === 'failure').map((c) => c.name);
    return {
      tone: 'failed',
      line: failed.length ? `CI failed · ${failed[0]}` : 'CI failed',
      checks: failed,
    };
  }
  const pending = checks.filter((c) => c.state === 'pending').map((c) => c.name);
  const count = passed !== null && total !== null ? ` · ${passed}/${total}` : '';
  return { tone: 'pending', line: `Waiting for CI${count}`, checks: pending };
}
