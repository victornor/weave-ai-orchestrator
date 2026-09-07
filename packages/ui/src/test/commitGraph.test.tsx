import { describe, expect, it } from 'vitest';
import { layoutGraph, type GraphCommit } from '../lib/commitGraph';

describe('layoutGraph', () => {
  it('a linear history is a single lane', () => {
    const commits: GraphCommit[] = [
      { sha: 'c3', parents: ['c2'] },
      { sha: 'c2', parents: ['c1'] },
      { sha: 'c1', parents: [] },
    ];
    const rows = layoutGraph(commits);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.laneCount === 1)).toBe(true);
    // The oldest row has no parent to continue toward: no edge leaves it.
    expect(rows[2]!.edges).toEqual([]);
  });

  it('a merge is drawn with a line to each parent lane', () => {
    // M merges c2 (a side branch) into c3 (mainline); both eventually share c1.
    const commits: GraphCommit[] = [
      { sha: 'm', parents: ['c3', 'c2'] },
      { sha: 'c3', parents: ['c1'] },
      { sha: 'c2', parents: ['c1'] },
      { sha: 'c1', parents: [] },
    ];
    const rows = layoutGraph(commits);
    const merge = rows[0]!;
    expect(merge.lane).toBe(0);
    expect(merge.edges).toEqual(expect.arrayContaining([{ fromLane: 0, toLane: 0 }, { fromLane: 0, toLane: 1 }]));
    expect(merge.edges).toHaveLength(2);
    expect(rows[1]!.lane).toBe(0); // c3 continues mainline's lane
    expect(rows[2]!.lane).toBe(1); // c2 keeps the side branch's own lane
    // c1 is the shared ancestor: both lanes converge back into one.
    const base = rows[3]!;
    expect(base.lane).toBe(0);
    expect(base.edges).toEqual([{ fromLane: 1, toLane: 0 }]);
  });

  it('two concurrent branches each keep their own lane, joined at their branch point', () => {
    const commits: GraphCommit[] = [
      { sha: 'b-tip', parents: ['base'] },
      { sha: 'a-tip', parents: ['base'] },
      { sha: 'base', parents: [] },
    ];
    const rows = layoutGraph(commits);
    expect(rows[0]!.lane).not.toBe(rows[1]!.lane); // b-tip and a-tip occupy distinct lanes
    expect(rows.map((r) => r.laneCount)).toEqual([2, 2, 2]);
    const base = rows[2]!;
    expect(base.lane).toBe(Math.min(rows[0]!.lane, rows[1]!.lane));
    expect(base.edges).toHaveLength(1); // the other lane converges into it
  });

  it('a squash landing has no merge edge: the branch commit shares no row with the squashed commit', () => {
    // S is a brand-new commit on main with a single parent (c1) — it never references c3, the
    // branch's real tip, which is exactly what a squash merge does.
    const commits: GraphCommit[] = [
      { sha: 's', parents: ['c1'] },
      { sha: 'c3', parents: ['c2'] },
      { sha: 'c2', parents: ['c1'] },
      { sha: 'c1', parents: [] },
    ];
    const rows = layoutGraph(commits);
    const squashed = rows[0]!;
    // No merge diamond at the landing: exactly one edge (its own continuation), never two.
    expect(squashed.edges).toHaveLength(1);
    expect(squashed.lane).not.toBe(rows[1]!.lane); // the branch's own lane is untouched by the squash
  });

  it('is deterministic: the same history lays out the same way twice', () => {
    const commits: GraphCommit[] = [
      { sha: 'm', parents: ['c3', 'c2'] },
      { sha: 'c3', parents: ['c1'] },
      { sha: 'c2', parents: ['c1'] },
      { sha: 'c1', parents: [] },
    ];
    expect(layoutGraph(commits)).toEqual(layoutGraph(commits));
  });

  it("a parent below the last row draws to the edge of what is shown", () => {
    const commits: GraphCommit[] = [{ sha: 'only', parents: ['not-shown'] }];
    const rows = layoutGraph(commits);
    // The continuation edge exists even though nothing lower down will ever consume it — that is
    // the line drawn "to the edge": there is no special case, it is simply never picked up again.
    expect(rows[0]!.edges).toEqual([{ fromLane: 0, toLane: 0 }]);
  });

  it('a root commit with no parents ends its lane with no continuation edge', () => {
    const rows = layoutGraph([{ sha: 'root', parents: [] }]);
    expect(rows[0]!.edges).toEqual([]);
    expect(rows[0]!.lanesAfter).toEqual([]); // its lane closed, nothing to draw through
  });

  it('lanesAfter tells a renderer which lanes stay open into the next row', () => {
    const commits: GraphCommit[] = [
      { sha: 'b-tip', parents: ['base'] },
      { sha: 'a-tip', parents: ['base'] },
      { sha: 'base', parents: [] },
    ];
    const rows = layoutGraph(commits);
    // Right after b-tip, both lanes (b-tip's own and a-tip's not-yet-seen one is not open yet) —
    // only b-tip's lane is open until a-tip is processed.
    expect(rows[0]!.lanesAfter).toEqual([rows[0]!.lane]);
    // After a-tip, both lanes are open: this is the gap where a renderer draws two parallel lines.
    expect(rows[1]!.lanesAfter.sort()).toEqual([rows[0]!.lane, rows[1]!.lane].sort());
    expect(rows[2]!.lanesAfter).toEqual([]); // base has no parents: both converge and close
  });
});
