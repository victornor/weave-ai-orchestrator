/**
 * VS-667: the pure count derivation behind every V2 header and rail row (`v2/v2Counts.ts`). These
 * assert the two counting rules with plain data — the per-workspace rows and the Everywhere figure
 * both, in both directions — the same way `liveCounts` is tested, without a router or a hook tree.
 */
import { describe, expect, it } from 'vitest';
import { agent, decision } from './factories';
import { deriveV2Counts } from '../v2/v2Counts';

const alpha = { id: 'alpha', needsYou: 0 };
const beta = { id: 'beta', needsYou: 0 };
const everywhere = { kind: 'everywhere' } as const;

describe('deriveV2Counts', () => {
  it('drops a closing decision from the Everywhere figure and that workspace\'s own row', () => {
    const open = decision({ id: 'd1', kind: 'question', status: 'open' });
    const before = deriveV2Counts({
      scope: everywhere,
      listed: [alpha, beta],
      decisions: [[], [open]],
      workers: [[], []],
      workingIds: new Set(),
      incidents: 0,
    });
    expect(before.needsGlobal).toBe(1);
    expect(before.needsByWs.beta).toBe(1);

    // The decision is answered in beta, elsewhere; its read now returns the open list without it.
    const after = deriveV2Counts({
      scope: everywhere,
      listed: [alpha, beta],
      decisions: [[], []],
      workers: [[], []],
      workingIds: new Set(),
      incidents: 0,
    });
    expect(after.needsGlobal).toBe(0);
    expect(after.needsByWs.beta).toBe(0);
    expect(after.needsByWs.alpha).toBe(0);
  });

  it('raises Live on the Everywhere figure and a workspace\'s own row when a worker joins', () => {
    const running = agent({ id: 'w1', workspaceId: 'beta', status: 'running' });
    const before = deriveV2Counts({
      scope: everywhere,
      listed: [alpha, beta],
      decisions: [[], []],
      workers: [[], []],
      workingIds: new Set(),
      incidents: 0,
    });
    expect(before.live).toBe(0);

    const after = deriveV2Counts({
      scope: everywhere,
      listed: [alpha, beta],
      decisions: [[], []],
      workers: [[], [running]],
      workingIds: new Set(['w1']),
      incidents: 0,
    });
    expect(after.live).toBe(1);
    expect(after.liveByWs.beta).toBe(1);
    expect(after.liveByWs.alpha).toBe(0);
  });

  it('scopes `needs` to the page\'s workspace, not the global total', () => {
    const a = decision({ id: 'd1', kind: 'question' });
    const b = decision({ id: 'd2', kind: 'question' });
    const counts = deriveV2Counts({
      scope: { kind: 'workspace', ws: 'alpha' },
      listed: [alpha, beta],
      decisions: [[a], [b]],
      workers: [[], []],
      workingIds: new Set(),
      incidents: 0,
    });
    expect(counts.needs).toBe(1);
    expect(counts.needsGlobal).toBe(2);
  });

  it('still excludes an approval the weaver has not reviewed (countsAsNeeds)', () => {
    const unseen = decision({ id: 'd1', kind: 'plan_approval', status: 'open', weaverReviewStatus: 'unseen' });
    const looked = decision({ id: 'd2', kind: 'plan_approval', status: 'open', weaverReviewStatus: 'looked' });
    const counts = deriveV2Counts({
      scope: everywhere,
      listed: [alpha],
      decisions: [[unseen, looked]],
      workers: [[], []],
      workingIds: new Set(),
      incidents: 0,
    });
    expect(counts.needsGlobal).toBe(1);
    expect(counts.needsByWs.alpha).toBe(1);
  });

  it('falls back to the workspace list\'s own needsYou until the read answers', () => {
    const counts = deriveV2Counts({
      scope: everywhere,
      listed: [{ id: 'alpha', needsYou: 3 }],
      decisions: [undefined],
      workers: [undefined],
      workingIds: new Set(),
      incidents: 0,
    });
    expect(counts.needsGlobal).toBe(3);
    // A defined but empty read means zero, not the fallback.
    const answered = deriveV2Counts({
      scope: everywhere,
      listed: [{ id: 'alpha', needsYou: 3 }],
      decisions: [[]],
      workers: [[]],
      workingIds: new Set(),
      incidents: 0,
    });
    expect(answered.needsGlobal).toBe(0);
  });
});
