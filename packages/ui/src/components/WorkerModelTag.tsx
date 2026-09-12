import type { Ticket, WorkerModelOption } from '@weave-ai/shared';
import { Badge } from './StatusGlyph';

/**
 * The worker model tier a ticket runs on, as a small tag (VS-217). It shows only when the
 * workspace configures more than one worker model option — derived from the effective catalog
 * at render time, never a hardcoded count or list. A ticket with no option id, or an id that
 * has since left the catalog, is labelled `default`: that is the setting its next turn resolves
 * to (`modelSettingFor` falls through), so a card is never left for the reader to interpret.
 */

export function workerModelTagLabel(ticket: Pick<Ticket, 'workerModelId'>, options?: WorkerModelOption[]): string | null {
  if (!options || options.length < 2) return null;
  const id = ticket.workerModelId;
  if (id && options.some((o) => o.id === id)) return id;
  return 'default';
}

export function WorkerModelTag({ ticket, options }: { ticket: Pick<Ticket, 'workerModelId'>; options?: WorkerModelOption[] }): React.ReactElement | null {
  const label = workerModelTagLabel(ticket, options);
  if (!label) return null;
  return <Badge>{label}</Badge>;
}
