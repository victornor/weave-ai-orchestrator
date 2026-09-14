/**
 * The line a ticket with a live worker shows (VS-368): its current activity with a ticking elapsed
 * clock, or — between turns — the worker's last run summary or a bare "Working". Either form carries
 * the amber working mark, so a running ticket never reads as idle.
 *
 * The mark is a *liveness* mark, not the ticket's status glyph: it belongs on a line, not in a card's
 * status area (HANDOFF §7 bans the status glyph on a V2 kanban card; hue is kept only where work is
 * live, §2). `line.since` is null for a run-summary line, so its elapsed clock does not keep ticking.
 */
import { StatusGlyph } from './StatusGlyph';
import { ActivityLine } from './TicketCard';

export interface LiveActivityLineModel {
  label: string;
  since: string | null;
}

export function LiveActivityLine({ line }: { line: LiveActivityLineModel | null }): React.ReactElement | null {
  if (!line) return null;
  if (line.since) {
    return (
      <div data-v2-activity>
        <ActivityLine activity={{ label: line.label, since: line.since }} />
      </div>
    );
  }
  return (
    <div data-v2-activity className="ac-mono mb-2 flex items-center gap-1.5 rounded-r4 bg-bg-2 px-2.5 py-1 text-nano text-text-2" title={line.label}>
      <StatusGlyph status="working" size="xs" pulse className="flex-none" />
      <span className="ac-truncate min-w-0">{line.label}</span>
    </div>
  );
}
