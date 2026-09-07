/**
 * Lane layout for the History section's commit graph (VS-96): a pure function over commits already
 * in display order (newest first), so the four fixture histories the ticket names — linear, one
 * merge, two concurrent branches, a squash landing — are literals, not a repository.
 *
 * `edges` on a row are the lines drawn from that row down to the next: a lane that nothing lower down
 * consumes (the graph's last loaded row, or a parent below what is shown) is a line drawn to the
 * edge of what is shown, which needs no special case — it is simply never picked up.
 */

export interface GraphEdge { fromLane: number; toLane: number }
export interface GraphRow {
  sha: string; lane: number; edges: GraphEdge[]; laneCount: number;
  /** Lane indices still open once this row's commit and its parents are placed — what a renderer draws as a plain vertical continuing into the next row, alongside `edges` for the lanes actually changing here. */
  lanesAfter: number[];
}
export interface GraphCommit { sha: string; parents: string[] }

export function layoutGraph(commits: readonly GraphCommit[]): GraphRow[] {
  // lanes[i] is the sha the lane is waiting for — the commit that will occupy it when reached.
  const lanes: Array<string | null> = [];
  const rows: Array<Omit<GraphRow, 'laneCount'>> = [];
  let maxLanes = 0;

  const firstFreeLane = (): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const waiting: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.sha) waiting.push(i);

    const lane = waiting.length > 0 ? Math.min(...waiting) : firstFreeLane();
    const edges: GraphEdge[] = [];

    // Every other lane also waiting for this commit converges into its lane — the branch point.
    for (const w of waiting) {
      if (w === lane) continue;
      edges.push({ fromLane: w, toLane: lane });
      lanes[w] = null;
    }

    const [firstParent, ...restParents] = commit.parents;
    if (firstParent === undefined) {
      lanes[lane] = null;
    } else {
      lanes[lane] = firstParent;
      edges.push({ fromLane: lane, toLane: lane });
      for (const parent of restParents) {
        const parentLane = firstFreeLane();
        lanes[parentLane] = parent;
        edges.push({ fromLane: lane, toLane: parentLane });
      }
    }

    maxLanes = Math.max(maxLanes, lanes.length);
    const lanesAfter: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] !== null) lanesAfter.push(i);
    rows.push({ sha: commit.sha, lane, edges, lanesAfter });
  }

  return rows.map((r) => ({ ...r, laneCount: maxLanes }));
}
