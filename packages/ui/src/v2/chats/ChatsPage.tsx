/**
 * V2 Global Chats (`/chats`): one pane per workspace, each running VS-349's V2 Chat screen
 * (web-v2/global-chats).
 *
 * The multi-pane behaviour is V1's (VS-336), and so is the model: order, per-pane width and collapsed
 * state are `lib/globalChatLayout`'s pure functions, remembered under V2's own key so V1's layout is
 * untouched. Exactly one pane is live at a time (VS-199): only the focused pane gets
 * `WorkspaceProvider live` and `V2ChatPage focused`, so the screen opens one event stream and one run
 * stream no matter how many workspaces are listed.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WorkspaceProvider } from '../../api/context';
import { useWorkspaces } from '../../api/hooks';
import { qk } from '../../api/keys';
import { Skeleton } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import { cx } from '../../lib/cx';
import {
  MIN_SPLIT,
  canCollapse,
  isCollapsed,
  movePane,
  nearestExpanded,
  placePane,
  readGlobalChatLayout,
  reconcileLayout,
  resetPair,
  setPairSplit,
  toggleCollapsed,
  weightOf,
  writeGlobalChatLayout,
  type GlobalChatLayout,
} from '../../lib/globalChatLayout';
import { V2Page } from '../V2Page';
import { V2_CHATS_LAYOUT_KEY } from '../prefs';
import { V2ChatPage } from '../ChatPage';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function V2ChatsScreen(): React.ReactElement {
  const workspaces = useWorkspaces();
  const qc = useQueryClient();
  const listed = workspaces.data;
  const list = listed ?? [];
  const listedIds = useMemo(() => list.map((w) => w.id), [list]);
  const byId = useMemo(() => new Map(list.map((w) => [w.id, w])), [list]);
  const [saved, setSaved] = useState<GlobalChatLayout>(() => readGlobalChatLayout(V2_CHATS_LAYOUT_KEY));
  const layout = useMemo(
    () => (listed === undefined ? saved : reconcileLayout(saved, listedIds)),
    [saved, listed, listedIds],
  );
  const [focusedWs, setFocusedWs] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const mutate = useCallback(
    (fn: (l: GlobalChatLayout) => GlobalChatLayout): void => {
      setSaved((prev) => fn(reconcileLayout(prev, listedIds)));
    },
    [listedIds],
  );

  useEffect(() => {
    if (listed === undefined) return;
    writeGlobalChatLayout(layout, listedIds, V2_CHATS_LAYOUT_KEY);
  }, [layout, listedIds, listed]);

  const desktop = !useMediaQuery('(max-width: 767px)');

  const focus = useCallback(
    (id: string) => {
      setFocusedWs(id);
      void qc.invalidateQueries({ queryKey: qk.threads(id) });
      void qc.invalidateQueries({ queryKey: qk.decisions(id) });
      void qc.invalidateQueries({ queryKey: qk.weaver(id) });
    },
    [qc],
  );

  const expanded = layout.order.filter((id) => !isCollapsed(layout, id));
  const focused = focusedWs !== null && expanded.includes(focusedWs) ? focusedWs : (expanded[0] ?? null);
  const totalWeight = expanded.reduce((sum, id) => sum + weightOf(layout.widths, id), 0);

  const collapse = (id: string): void => {
    if (!canCollapse(layout, id)) return;
    if (id === focused) {
      const next = nearestExpanded(layout, id);
      if (next !== null) focus(next);
    }
    mutate((l) => toggleCollapsed(l, id));
  };

  const expand = (id: string): void => {
    mutate((l) => toggleCollapsed(l, id));
    focus(id);
  };

  const move = (id: string, dir: -1 | 1): void => {
    setMenuFor(null);
    mutate((l) => ({ ...l, order: movePane(l.order, id, dir) }));
  };

  const split = (leftId: string, rightId: string, nextLeft: number): void => {
    mutate((l) => ({ ...l, widths: setPairSplit(l.widths, leftId, rightId, nextLeft) }));
  };

  const reset = (leftId: string, rightId: string): void => {
    mutate((l) => ({ ...l, widths: resetPair(l.widths, leftId, rightId) }));
  };

  const onPaneDragOver = (e: React.DragEvent<HTMLElement>, index: number, id: string): void => {
    if (dragId === null || dragId === id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const before = rect.width > 0 ? e.clientX < rect.left + rect.width / 2 : index === 0;
    setDropIndex(before ? index : index + 1);
  };

  const commitDrop = (): void => {
    if (dragId !== null && dropIndex !== null) {
      const dragged = dragId;
      const target = dropIndex;
      mutate((l) => ({ ...l, order: placePane(l.order, dragged, target) }));
    }
    setDragId(null);
    setDropIndex(null);
  };

  let previousExpanded: string | null = null;

  return (
    <V2Page title="Chats" subtitle={list.length ? `${list.length} workspaces` : undefined}>
      <div className="flex h-full min-h-0">
        {workspaces.isError ? (
          <ErrorState
            className="m-4"
            code="WORKSPACES_QUERY_FAILED"
            message="Could not load workspaces."
            onRetry={() => void workspaces.refetch()}
          />
        ) : !workspaces.data ? (
          <div className="flex h-full gap-3 overflow-x-auto p-4">
            <Skeleton className="h-full min-w-80 flex-1" />
            <Skeleton className="h-full min-w-80 flex-1" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState className="m-4" title="No workspaces." detail="Create a workspace to talk to its weaver." />
        ) : (
          <div
            className="flex h-full min-h-0 overflow-x-auto"
            onDragOver={(e) => {
              if (dragId !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              commitDrop();
            }}
          >
            {layout.order.map((id, index) => {
              const w = byId.get(id);
              if (!w) return null;
              const collapsed = isCollapsed(layout, id);
              const live = id === focused;
              const name = w.name;
              const leftId = previousExpanded;
              const separator =
                desktop && !collapsed && leftId !== null ? (
                  <PaneSeparator
                    leftId={leftId}
                    rightId={id}
                    leftName={byId.get(leftId)?.name ?? leftId}
                    rightName={name}
                    leftWeight={weightOf(layout.widths, leftId)}
                    pairWeight={weightOf(layout.widths, leftId) + weightOf(layout.widths, id)}
                    totalWeight={totalWeight}
                    onSplit={(next) => split(leftId, id, next)}
                    onReset={() => reset(leftId, id)}
                  />
                ) : null;
              if (!collapsed) previousExpanded = id;
              return (
                <Fragment key={id}>
                  {dropIndex === index ? <DropIndicator /> : null}
                  {separator}
                  <section
                    aria-label={name}
                    data-collapsed={collapsed ? 'true' : undefined}
                    onDragOver={(e) => onPaneDragOver(e, index, id)}
                    onDrop={(e) => {
                      e.preventDefault();
                      commitDrop();
                    }}
                    style={desktop && !collapsed ? { flexGrow: weightOf(layout.widths, id), flexBasis: 0 } : undefined}
                    className={cx(
                      'flex min-h-0 flex-col border-r border-line-1 last:border-r-0',
                      collapsed ? 'w-10 flex-none' : 'min-w-80',
                      !desktop && !collapsed ? 'flex-1' : undefined,
                    )}
                  >
                    {collapsed ? (
                      <button
                        type="button"
                        aria-label={`Expand ${name}`}
                        title={name}
                        onClick={() => expand(id)}
                        className="flex h-full w-full flex-col items-center gap-2 py-3 text-text-1 outline-none hover:bg-bg-2 focus-visible:bg-bg-2"
                      >
                        <span className="[writing-mode:vertical-rl] rotate-180 truncate text-ui font-medium">{name}</span>
                        {w.needsYou > 0 ? (
                          <span className="ac-mono rounded-r4 bg-needs-you px-1 text-nano text-bg-0" aria-label={`${w.needsYou} waiting for you`}>
                            {w.needsYou}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      <>
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDragId(id);
                            if (e.dataTransfer) {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', id);
                            }
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDropIndex(null);
                          }}
                          className={cx(
                            'relative flex h-[38px] flex-none items-stretch border-b',
                            live ? 'border-accent-edge bg-accent-tint' : 'border-line-1 hover:bg-bg-2',
                          )}
                        >
                          <button
                            type="button"
                            aria-current={live}
                            onClick={() => focus(id)}
                            className="min-w-0 flex-1 truncate px-3.5 text-left text-ui font-medium text-text-1 outline-none focus-visible:bg-bg-2"
                          >
                            {name}
                          </button>
                          {w.needsYou > 0 ? (
                            <span className="ac-mono self-center px-1 text-nano text-needs-you" aria-label={`${w.needsYou} waiting for you`}>
                              {w.needsYou}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Collapse ${name}`}
                            title="Collapse to a sliver"
                            disabled={!canCollapse(layout, id)}
                            onClick={() => collapse(id)}
                            className="flex-none px-1.5 text-meta text-text-3 outline-none hover:text-text-1 focus-visible:bg-bg-2 disabled:opacity-30"
                          >
                            ⟩
                          </button>
                          <button
                            type="button"
                            aria-label={`Reorder ${name}`}
                            title="Reorder and move this pane"
                            aria-haspopup="menu"
                            aria-expanded={menuFor === id}
                            onClick={() => setMenuFor(menuFor === id ? null : id)}
                            className="flex-none px-1.5 text-meta text-text-3 outline-none hover:text-text-1 focus-visible:bg-bg-2"
                          >
                            ⋯
                          </button>
                          {menuFor === id ? (
                            <div
                              role="menu"
                              aria-label={`Reorder ${name}`}
                              className="v2-anim-menu absolute top-full right-0 z-20 mt-px flex min-w-32 flex-col rounded-r4 border border-line-1 bg-bg-0 py-1 shadow-sheet"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                disabled={index === 0}
                                onClick={() => move(id, -1)}
                                className="px-3 py-1.5 text-left text-meta text-text-1 outline-none hover:bg-bg-2 disabled:opacity-30"
                              >
                                Move left
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={index === layout.order.length - 1}
                                onClick={() => move(id, 1)}
                                className="px-3 py-1.5 text-left text-meta text-text-1 outline-none hover:bg-bg-2 disabled:opacity-30"
                              >
                                Move right
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col">
                          <WorkspaceProvider ws={id} remember={false} live={live}>
                            <V2ChatPage focused={live} />
                          </WorkspaceProvider>
                        </div>
                      </>
                    )}
                  </section>
                </Fragment>
              );
            })}
            {dropIndex === layout.order.length ? <DropIndicator /> : null}
          </div>
        )}
      </div>
    </V2Page>
  );
}

/** The thin accent bar shown where a dragged pane would land. */
function DropIndicator(): React.ReactElement {
  return <span data-testid="drop-indicator" aria-hidden className="w-0.5 flex-none self-stretch bg-accent" />;
}

/**
 * The vertical separator between two adjacent expanded panes. Pointer capture plus window listeners,
 * `touch-action: none`, arrow keys and double-click to reset — V1's hand-rolled handle pattern, V2's
 * chrome. The row's pixel width is read once at drag start and the travel is turned into a weight
 * delta with it; `setPairSplit` clamps the result.
 */
function PaneSeparator({
  leftId,
  rightId,
  leftName,
  rightName,
  leftWeight,
  pairWeight,
  totalWeight,
  onSplit,
  onReset,
}: {
  leftId: string;
  rightId: string;
  leftName: string;
  rightName: string;
  leftWeight: number;
  pairWeight: number;
  totalWeight: number;
  onSplit: (nextLeftWeight: number) => void;
  onReset: () => void;
}): React.ReactElement {
  const [origin, setOrigin] = useState<{ x: number; rowWidth: number; leftWeight: number; total: number } | null>(null);
  const splitRef = useRef(onSplit);
  splitRef.current = onSplit;

  const start = (e: React.PointerEvent<HTMLDivElement>): void => {
    const row = e.currentTarget.parentElement;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setOrigin({ x: e.clientX, rowWidth: row ? row.getBoundingClientRect().width : 0, leftWeight, total: totalWeight });
  };

  useEffect(() => {
    if (!origin) return;
    const move = (e: PointerEvent): void => {
      const delta = origin.rowWidth > 0 ? ((e.clientX - origin.x) * origin.total) / origin.rowWidth : 0;
      splitRef.current(origin.leftWeight + delta);
    };
    const end = (): void => setOrigin(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [origin]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onReset();
      return;
    }
    const step = totalWeight * 0.05;
    const next = e.key === 'ArrowLeft' ? leftWeight - step : e.key === 'ArrowRight' ? leftWeight + step : null;
    if (next === null) return;
    e.preventDefault();
    onSplit(next);
  };

  const share = pairWeight > 0 ? leftWeight / pairWeight : 0.5;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize between ${leftName} and ${rightName}`}
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={Math.round(MIN_SPLIT * 100)}
      aria-valuemax={100 - Math.round(MIN_SPLIT * 100)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={start}
      onDoubleClick={onReset}
      onKeyDown={onKey}
      data-testid={`separator-${leftId}-${rightId}`}
      className="w-1.5 flex-none cursor-col-resize touch-none select-none bg-line-1 outline-none hover:bg-accent focus-visible:bg-bg-2"
    />
  );
}
