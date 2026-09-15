/**
 * The V2 project overview's Roadmap section (VS-397, roadmap/project-page): a project's future ideas,
 * in order, editable in place, updating live through the workspace event stream. Not a ticket list —
 * an item is a remembered idea and only becomes a ticket when captain starts it.
 */
import { useState } from 'react';
import type { RoadmapItem } from '@weave-ai/shared';
import { A } from '../../app/link';
import { Button } from '../../components/Button';
import { Markdown } from '../../components/Markdown';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { useToast } from '../../components/Toast';
import { useCreateRoadmapItem, usePatchRoadmapItem, useRemoveRoadmapItem, useRoadmap, useTickets } from '../../api/hooks';
import { cx } from '../../lib/cx';
import type { V2ProjectSectionProps } from './sections';

const STATUSES: RoadmapItem['status'][] = ['idea', 'planned', 'dropped'];

const STATUS_TONE: Record<RoadmapItem['status'], string> = {
  idea: 'text-text-2',
  planned: 'text-accent-link',
  dropped: 'text-text-4 line-through',
};

const inputCx = 'h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none';

export function RoadmapSection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const road = useRoadmap(project.id);
  const tickets = useTickets({ limit: 300 });
  const create = useCreateRoadmapItem();
  const patch = usePatchRoadmapItem();
  const remove = useRemoveRoadmapItem();
  const toast = useToast();

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const items = road.data ?? [];
  const identifierOf = (ticketId: string | null): string | null =>
    ticketId ? (tickets.data ?? []).find((t) => t.id === ticketId)?.identifier ?? null : null;
  const fail = (title: string) => (e: Error) => toast.push({ title, detail: e.message, status: 'failed' });

  const add = (): void => {
    const title = draft.trim();
    if (!title) return;
    create.mutate({ projectId: project.id, title }, { onSuccess: () => setDraft(''), onError: fail('Could not add the idea') });
  };

  const move = (item: RoadmapItem, index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    patch.mutate({ projectId: project.id, itemId: item.id, patch: { position: target } }, { onError: fail('Could not reorder') });
  };

  const beginEdit = (item: RoadmapItem): void => { setEditing(item.id); setEditTitle(item.title); setEditNotes(item.notes); };
  const saveEdit = (item: RoadmapItem): void => {
    const title = editTitle.trim();
    if (!title) return;
    patch.mutate(
      { projectId: project.id, itemId: item.id, patch: { title, notes: editNotes } },
      { onSuccess: () => setEditing(null), onError: fail('Could not save the idea') },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          className={inputCx}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Add an idea…"
          aria-label="Add a roadmap idea"
        />
        <Button size="sm" disabled={!draft.trim() || create.isPending} onClick={add}>Add</Button>
      </div>

      {road.isLoading ? (
        <SkeletonRows rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No ideas on the roadmap yet."
          detail="This is where future ideas for this project live — things not ready to become tickets. Add one above, or ask the weaver to put something on the roadmap."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => {
            const identifier = identifierOf(item.ticketId);
            return (
              <li key={item.id} className="flex flex-col gap-1.5 rounded-r4 border border-line-1 px-2.5 py-2">
                {editing === item.id ? (
                  <div className="flex flex-col gap-2">
                    <input className={inputCx} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="Idea title" />
                    <textarea
                      className={cx(inputCx, 'h-20 py-1')}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Notes (markdown)"
                      aria-label="Idea notes"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="primary" disabled={!editTitle.trim() || patch.isPending} onClick={() => saveEdit(item)}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={cx('v2-tag flex-none', STATUS_TONE[item.status])}>{item.status}</span>
                      <span className="min-w-0 flex-1 truncate text-meta text-text-1">{item.title}</span>
                      {identifier ? (
                        <A to="/w/$ws/tickets/$ticketId" params={{ ws, ticketId: identifier }} className="ac-mono flex-none text-nano text-accent-link">
                          {identifier}
                        </A>
                      ) : null}
                      <select
                        className="h-7 flex-none rounded-r4 border border-line-2 bg-bg-input px-1 text-nano text-text-2 outline-none"
                        value={item.status}
                        aria-label={`Status of ${item.title}`}
                        onChange={(e) => patch.mutate({ projectId: project.id, itemId: item.id, patch: { status: e.target.value as RoadmapItem['status'] } }, { onError: fail('Could not change status') })}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {item.notes ? <Markdown className="text-micro text-text-2" source={item.notes} /> : null}

                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Move ${item.title} up`} disabled={index === 0 || patch.isPending} onClick={() => move(item, index, -1)}>↑</Button>
                      <Button size="sm" variant="ghost" aria-label={`Move ${item.title} down`} disabled={index === items.length - 1 || patch.isPending} onClick={() => move(item, index, 1)}>↓</Button>
                      <Button size="sm" variant="ghost" onClick={() => beginEdit(item)}>Edit</Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${item.title}`} disabled={remove.isPending} onClick={() => remove.mutate({ projectId: project.id, itemId: item.id }, { onError: fail('Could not delete the idea') })}>Delete</Button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
