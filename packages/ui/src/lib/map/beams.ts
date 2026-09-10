/**
 * Worker beams for the global Map (VS-192): a decorative overlay only. A beam is never a
 * `MapNode`, never counted among the graph's nodes or edges, and does not affect layout — see
 * design.md §6 and the "A live worker draws a fading beam to its ticket" requirement.
 */
import type { Agent } from '@agent-conductor/shared';
import type { MapModel } from './model';

export interface Beam {
  workerId: string;
  /** The node the beam travels from — the ticket's own role, else project, else workspace. */
  from: string;
  /** The ticket node the beam travels to. */
  to: string;
}

/**
 * One beam per live worker that holds a ticket with a node on `model`. `from` reuses the
 * ticket's own incoming edge — the same role/project/workspace parent `buildMapModel` already
 * resolved for that ticket — rather than re-deriving it.
 */
export function beamsFor(liveWorkers: readonly Pick<Agent, 'id' | 'ticketId'>[], model: MapModel): Beam[] {
  const out: Beam[] = [];
  for (const w of liveWorkers) {
    if (!w.ticketId) continue;
    const to = `ticket:${w.ticketId}`;
    if (!model.byId.has(to)) continue;
    const edge = model.edges.find((e) => e.target === to);
    if (!edge) continue;
    out.push({ workerId: w.id, from: edge.source, to });
  }
  return out;
}
