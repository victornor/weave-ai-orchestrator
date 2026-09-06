/**
 * The knowledge graph: hub files and documents as nodes, `[[links]]` as edges, laid out by a live
 * `d3-force` simulation you can drag, zoom, pan, search and filter.
 *
 * The division of labour matters here. React renders the *structure* — one group per node, one path
 * per edge, one region per project — and never re-renders it on a tick; the simulation writes the
 * geometry straight onto those elements through a ref map. That is the difference between a graph
 * that stays at 60 fps with 200 nodes and a re-render storm. Everything that can be reasoned about
 * without a DOM — the model, the layout, the viewport arithmetic, the filters — lives in
 * `../lib/graph/` and is unit-tested there.
 *
 * Under `prefers-reduced-motion` nothing animates: the layout is settled in one synchronous pass and
 * the viewport moves in one step. Under the phone breakpoint the default is the neighbour list
 * (DESIGN-CONTRACT §7.4), with the canvas one tap away.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Button } from '../components/Button';
import { useKnowledgeGraph } from '../api/hooks';
import { cx } from '../lib/cx';
import { buildModel, type GraphModel, type GraphNode } from '../lib/graph/model';
import { edgeDimmed, highlighted, matchingIds, nodeDimmed, visible } from '../lib/graph/filters';
import { createSimulation, nodeRadius, type GraphSimulation, type SimLink, type SimNode } from '../lib/graph/simulation';
import { hullPath, type Point } from '../lib/graph/hull';
import {
  boundsOf,
  centreOn,
  fitTo,
  IDENTITY,
  labelDetail,
  toSvg,
  toGraph,
  panBy,
  pinchScale,
  midpoint,
  zoomAround,
  type LabelDetail,
  type Size,
  type ViewportTransform,
} from '../lib/graph/viewport';

const PALETTE = ['var(--accent)', 'var(--status-done)', 'var(--status-working)', 'var(--status-merging)', 'var(--status-blocked)', 'var(--status-needs-you)'];

/** Used when the frame has not been measured — jsdom has no layout, and neither has a first paint. */
const FALLBACK_SIZE: Size = { width: 900, height: 520 };
/** A pointer that moved less than this between down and up was a click, not a drag. */
const CLICK_SLOP_PX = 4;
/** How far a cluster region is drawn outside the nodes it encloses, in graph units. */
const HULL_PAD = 30;
const VIEW_TWEEN_MS = 260;

/** A media query as a boolean that follows changes. */
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

export function KnowledgeGraphView({ project, onOpen }: { project?: string; onOpen: (path: string) => void }): React.ReactElement {
  const graph = useKnowledgeGraph(project);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery('(max-width: 640px)');
  const animated = !reduced;

  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pins, setPins] = useState<ReadonlySet<string>>(() => new Set());
  const [detail, setDetail] = useState<LabelDetail>('truncated');
  const [canvas, setCanvas] = useState(false);

  const model = useMemo(() => (graph.data ? buildModel(graph.data) : null), [graph.data]);
  const shown = useMemo(() => (model ? visible(model, hidden) : null), [model, hidden]);
  const matches = useMemo(() => (model ? matchingIds(model, query) : null), [model, query]);
  const lit = useMemo(() => (shown ? highlighted(shown, hover ?? selected) : null), [shown, hover, selected]);
  const colourOf = useCallback((group: string): string => PALETTE[Math.max(0, model?.groups.indexOf(group) ?? 0) % PALETTE.length]!, [model]);

  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const labelRefs = useRef(new Map<string, SVGGElement>());
  const edgeRefs = useRef(new Map<string, SVGPathElement>());
  const hullRefs = useRef(new Map<string, SVGPathElement>());
  const simRef = useRef<GraphSimulation | null>(null);
  const viewRef = useRef<ViewportTransform>(IDENTITY);
  const sizeRef = useRef<Size>(FALLBACK_SIZE);
  const autoFitRef = useRef(true);
  /** Set when nodes have come or gone: their labels have no counter-scale written yet. */
  const labelsDirtyRef = useRef(true);
  const tweenRef = useRef<number | null>(null);

  const measure = useCallback((): Size => {
    const el = frameRef.current;
    const width = el?.clientWidth || FALLBACK_SIZE.width;
    const height = el?.clientHeight || FALLBACK_SIZE.height;
    sizeRef.current = { width, height };
    return sizeRef.current;
  }, []);

  /**
   * Write the viewport out. Labels are counter-scaled so they stay the same size on screen at any
   * zoom, which only needs doing when the zoom itself moved — panning and the settling layout leave
   * every label where it was relative to its node.
   */
  const applyView = useCallback((next: ViewportTransform): void => {
    const zoomed = viewRef.current.k !== next.k;
    viewRef.current = next;
    sceneRef.current?.setAttribute('transform', toSvg(next));
    if (zoomed) {
      writeLabels(labelRefs.current, next.k);
      labelsDirtyRef.current = false;
      setDetail((was) => {
        const now = labelDetail(next.k);
        return now === was ? was : now;
      });
    }
  }, []);

  /** Move the viewport — in one step for reduced motion, eased otherwise. */
  const moveView = useCallback((target: ViewportTransform): void => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    tweenRef.current = null;
    if (!animated) {
      applyView(target);
      return;
    }
    const from = viewRef.current;
    const started = performance.now();
    const step = (): void => {
      const p = Math.min(1, (performance.now() - started) / VIEW_TWEEN_MS);
      const e = 1 - (1 - p) * (1 - p);
      applyView({ k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      tweenRef.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    step();
  }, [animated, applyView]);

  /** The one place geometry reaches the DOM: called on every simulation tick. */
  const draw = useCallback((): void => {
    const sim = simRef.current;
    if (!sim) return;
    const nodes = sim.nodes();

    if (labelsDirtyRef.current) {
      writeLabels(labelRefs.current, viewRef.current.k);
      labelsDirtyRef.current = false;
    }

    for (const n of nodes) nodeRefs.current.get(n.id)?.setAttribute('transform', `translate(${n.x} ${n.y})`);

    for (const link of sim.links()) {
      const el = edgeRefs.current.get(link.id);
      if (!el) continue;
      el.setAttribute('d', edgePath(link));
    }

    const byGroup = new Map<string, Point[]>();
    for (const n of nodes) {
      const points = byGroup.get(n.group) ?? [];
      points.push({ x: n.x, y: n.y });
      byGroup.set(n.group, points);
    }
    for (const [group, el] of hullRefs.current) {
      const d = hullPath(byGroup.get(group) ?? [], HULL_PAD);
      if (d) el.setAttribute('d', d);
      else el.removeAttribute('d');
    }

    if (autoFitRef.current) {
      const bounds = boundsOf(nodes.map((n) => ({ x: n.x, y: n.y })));
      if (bounds) applyView(fitTo(bounds, sizeRef.current));
    }
  }, [applyView]);

  // The simulation: created once per motion preference, updated whenever the visible graph changes.
  const animatedRef = useRef(animated);
  useEffect(() => {
    if (!shown) return;
    const size = measure();
    if (simRef.current && animatedRef.current !== animated) {
      simRef.current.destroy();
      simRef.current = null;
    }
    animatedRef.current = animated;
    let sim = simRef.current;
    if (!sim) {
      sim = createSimulation(shown, size, { animated });
      simRef.current = sim;
      sim.onTick(draw);
      sim.start(1);
    } else {
      sim.update(shown, size);
    }
    labelsDirtyRef.current = true;
    draw();
    setPins(new Set(sim.pinned()));
  }, [shown, animated, draw, measure]);

  useEffect(() => () => {
    simRef.current?.destroy();
    simRef.current = null;
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
  }, []);

  useEffect(() => {
    const onResize = (): void => {
      measure();
      if (autoFitRef.current) draw();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw, measure]);

  useEffect(() => { setSelected(null); }, [project]);

  const focusNode = useCallback((id: string): void => {
    const n = simRef.current?.node(id);
    if (!n) return;
    autoFitRef.current = false;
    moveView(centreOn(viewRef.current, { x: n.x, y: n.y }, sizeRef.current));
  }, [moveView]);

  // A search that lands on exactly one page brings it into view.
  useEffect(() => {
    if (!matches || matches.size !== 1) return;
    const [only] = matches;
    if (only) focusNode(only);
  }, [matches, focusNode]);

  const fitView = useCallback((): void => {
    const nodes = simRef.current?.nodes() ?? [];
    const bounds = boundsOf(nodes.map((n) => ({ x: n.x, y: n.y })));
    autoFitRef.current = false;
    if (bounds) moveView(fitTo(bounds, measure()));
  }, [measure, moveView]);

  const resetView = useCallback((): void => {
    autoFitRef.current = false;
    moveView(IDENTITY);
  }, [moveView]);

  const togglePin = useCallback((id: string): void => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.isPinned(id)) sim.unpin(id);
    else sim.pin(id);
    setPins(new Set(sim.pinned()));
  }, []);

  // ── pointers ───────────────────────────────────────────────────────────────────────────────────

  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<{ pointerId: number; nodeId: string | null; last: Point; moved: number } | null>(null);
  const pinchRef = useRef<readonly [Point, Point] | null>(null);
  const draggedRef = useRef(false);

  const localPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    const at = localPoint(e);
    pointersRef.current.set(e.pointerId, at);
    draggedRef.current = false;
    autoFitRef.current = false;
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = [a!, b!];
      gestureRef.current = null;
      return;
    }
    const nodeId = (e.target as Element | null)?.closest?.('[data-node]')?.getAttribute('data-node') ?? null;
    gestureRef.current = { pointerId: e.pointerId, nodeId, last: at, moved: 0 };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const at = localPoint(e);
    pointersRef.current.set(e.pointerId, at);

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const now = [a!, b!] as const;
      applyView(zoomAround(viewRef.current, midpoint(now[0], now[1]), pinchScale(pinchRef.current, now)));
      pinchRef.current = now;
      return;
    }

    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const dx = at.x - gesture.last.x;
    const dy = at.y - gesture.last.y;
    gesture.last = at;
    gesture.moved += Math.hypot(dx, dy);
    if (gesture.moved > CLICK_SLOP_PX) draggedRef.current = true;

    if (gesture.nodeId) {
      const g = toGraph(viewRef.current, at);
      simRef.current?.drag(gesture.nodeId, g.x, g.y);
    } else {
      applyView(panBy(viewRef.current, dx, dy));
    }
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>): void => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const gesture = gestureRef.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      if (gesture.nodeId) simRef.current?.endDrag(gesture.nodeId);
      gestureRef.current = null;
    }
    svgRef.current?.releasePointerCapture?.(e.pointerId);
  };

  // Wheel has to be a native non-passive listener: React's is passive, so it cannot stop the page
  // scrolling underneath the graph.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      autoFitRef.current = false;
      applyView(zoomAround(viewRef.current, localPoint(e), Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView, localPoint, canvas, phone]);

  const selectNode = (id: string): void => {
    if (draggedRef.current) return;
    setSelected(id);
  };

  // ── render ─────────────────────────────────────────────────────────────────────────────────────

  if (graph.isLoading) return <SkeletonRows rows={6} />;
  if (graph.isError) return <ErrorState code="KNOWLEDGE_GRAPH_FAILED" message="The graph could not be built." onRetry={() => void graph.refetch()} />;
  if (!model || !model.nodes.length || !shown) return <EmptyState title="Nothing to draw yet." detail="The graph fills in as documents are written and linked." />;

  const asList = phone && !canvas;
  const sel = selected ? model.byId.get(selected) ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages"
          aria-label="Search the graph"
          className="ac-mono h-7 min-w-40 flex-1 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1"
        />
        {!asList ? (
          <>
            <Button size="sm" onClick={fitView}>Fit</Button>
            <Button size="sm" onClick={resetView}>Reset</Button>
          </>
        ) : null}
        {phone ? (
          <Button size="sm" onClick={() => setCanvas((v) => !v)}>{canvas ? 'List' : 'Canvas'}</Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {model.groups.map((g) => {
          const off = hidden.has(g);
          return (
            <button
              key={g}
              type="button"
              aria-pressed={!off}
              onClick={() => setHidden((was) => {
                const next = new Set(was);
                if (next.has(g)) next.delete(g);
                else next.add(g);
                return next;
              })}
              className={cx('flex items-center gap-1.5 text-micro', off ? 'text-text-4 line-through' : 'text-text-2')}
            >
              <span className="size-2 rounded-full" style={{ background: colourOf(g), opacity: off ? 0.3 : 1 }} />
              {g}
            </button>
          );
        })}
        <span className="ac-mono ml-auto text-nano text-text-4">
          {shown.nodes.length} pages · {shown.edges.length} links{matches ? ` · ${matches.size} matching` : ''}
        </span>
      </div>

      {shown.nodes.length === 0 ? (
        <EmptyState title="Every group is hidden." detail="Switch a project or scope back on to see its pages." />
      ) : asList ? (
        <GraphNeighbourList model={shown} selected={selected} onSelect={setSelected} onOpen={onOpen} colourOf={colourOf} />
      ) : (
        <div ref={frameRef} className="ac-card relative overflow-hidden p-0">
          <svg
            ref={svgRef}
            className="h-[32rem] w-full touch-none select-none"
            aria-label="Knowledge graph"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <defs>
              <marker id="ac-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" fill="var(--line-3)" />
              </marker>
            </defs>
            <g ref={sceneRef}>
              <g aria-hidden="true">
                {shown.groups.map((g) => (
                  <path
                    key={g}
                    ref={(el) => { if (el) hullRefs.current.set(g, el); else hullRefs.current.delete(g); }}
                    fill={colourOf(g)}
                    fillOpacity={0.07}
                    stroke={colourOf(g)}
                    strokeOpacity={0.18}
                    strokeWidth={1.5}
                  />
                ))}
              </g>
              <g aria-hidden="true">
                {shown.edges.map((e) => {
                  const dim = edgeDimmed(e, lit, matches);
                  return (
                    <path
                      key={e.id}
                      ref={(el) => { if (el) edgeRefs.current.set(e.id, el); else edgeRefs.current.delete(e.id); }}
                      data-edge={e.id}
                      fill="none"
                      stroke="var(--line-3)"
                      strokeWidth={dim ? 0.8 : 1.6}
                      strokeOpacity={dim ? 0.25 : 0.85}
                      markerEnd={e.directed ? 'url(#ac-graph-arrow)' : undefined}
                    />
                  );
                })}
              </g>
              <g>
                {shown.nodes.map((n) => (
                  <GraphNodeShape
                    key={n.id}
                    node={n}
                    colour={colourOf(n.group)}
                    dimmed={nodeDimmed(n.id, lit, matches)}
                    selected={selected === n.id}
                    pinned={pins.has(n.id)}
                    label={labelFor(n, detail, selected === n.id || hover === n.id)}
                    nodeRef={(el) => { if (el) nodeRefs.current.set(n.id, el); else nodeRefs.current.delete(n.id); }}
                    labelRef={(el) => { if (el) labelRefs.current.set(n.id, el); else labelRefs.current.delete(n.id); }}
                    onEnter={() => setHover(n.id)}
                    onLeave={() => setHover((was) => (was === n.id ? null : was))}
                    onSelect={() => selectNode(n.id)}
                    onOpen={() => onOpen(n.id)}
                  />
                ))}
              </g>
            </g>
          </svg>
        </div>
      )}

      {sel ? (
        <GraphDetailPanel
          model={model}
          node={sel}
          pinned={pins.has(sel.id)}
          colour={colourOf(sel.group)}
          onOpen={onOpen}
          onFocus={(id) => { setSelected(id); focusNode(id); }}
          onTogglePin={() => togglePin(sel.id)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

export default KnowledgeGraphView;

/** What a node's label says at this zoom. A hub, and whatever is focused, is always named. */
function labelFor(node: GraphNode, detail: LabelDetail, focused: boolean): string | null {
  if (detail === 'none' && node.kind !== 'hub' && !focused) return null;
  if (detail === 'full' || focused) return node.title;
  return node.title.length > 26 ? `${node.title.slice(0, 24)}…` : node.title;
}

function edgePath(link: SimLink): string {
  const s = link.source as SimNode;
  const t = link.target as SimNode;
  if (typeof s !== 'object' || typeof t !== 'object') return '';
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const gap = link.directed ? 4 : 1;
  return `M${round(s.x + ux * s.radius)} ${round(s.y + uy * s.radius)}L${round(t.x - ux * (t.radius + gap))} ${round(t.y - uy * (t.radius + gap))}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Hold every label at the same on-screen size, whatever the zoom, just below its node. */
function writeLabels(labels: ReadonlyMap<string, SVGGElement>, k: number): void {
  const inverse = 1 / k;
  for (const el of labels.values()) {
    el.setAttribute('transform', `translate(0 ${Number(el.dataset['r'] ?? 8)}) scale(${inverse})`);
  }
}

function GraphNodeShape({
  node, colour, dimmed, selected, pinned, label, nodeRef, labelRef, onEnter, onLeave, onSelect, onOpen,
}: {
  node: GraphNode;
  colour: string;
  dimmed: boolean;
  selected: boolean;
  pinned: boolean;
  label: string | null;
  nodeRef: (el: SVGGElement | null) => void;
  labelRef: (el: SVGGElement | null) => void;
  onEnter: () => void;
  onLeave: () => void;
  onSelect: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const r = nodeRadius(node);
  return (
    <g
      ref={nodeRef}
      data-node={node.id}
      data-dimmed={dimmed ? 'true' : undefined}
      data-pinned={pinned ? 'true' : undefined}
      role="button"
      tabIndex={0}
      aria-label={node.title}
      className="cursor-pointer"
      opacity={dimmed ? 0.22 : 1}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onSelect(); }
        if (e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
    >
      {node.kind === 'hub' ? (
        <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} transform="rotate(45)" fill={colour} fillOpacity={0.9} stroke={selected ? 'var(--text-1)' : 'var(--bg-0)'} strokeWidth={selected ? 2.5 : 1.5} />
      ) : (
        <circle r={r} fill={colour} fillOpacity={0.85} stroke={selected ? 'var(--text-1)' : 'var(--bg-0)'} strokeWidth={selected ? 2.5 : 1.5} />
      )}
      {pinned ? <circle cx={r * 0.72} cy={-r * 0.72} r={3} fill="var(--text-1)" stroke="var(--bg-0)" strokeWidth={1} /> : null}
      <g ref={labelRef} data-r={node.kind === 'hub' ? r * 1.45 : r} aria-hidden="true">
        {label ? (
          <text y={11} textAnchor="middle" fontSize={11} fill="var(--text-2)" className={cx('pointer-events-none', node.kind === 'hub' && 'font-semibold')}>
            {label}
          </text>
        ) : null}
      </g>
    </g>
  );
}

export function GraphDetailPanel({
  model, node, pinned, colour, onOpen, onFocus, onTogglePin, onClose,
}: {
  model: GraphModel;
  node: GraphNode;
  pinned: boolean;
  colour: string;
  onOpen: (path: string) => void;
  onFocus: (id: string) => void;
  onTogglePin: () => void;
  onClose: () => void;
}): React.ReactElement {
  const out = model.outgoing.get(node.id) ?? [];
  const inc = model.incoming.get(node.id) ?? [];
  // A page cited in both directions belongs in one row, not two: the panel would otherwise list it
  // twice and say nothing about the fact that the link is mutual.
  const both = out.filter((id) => inc.includes(id));
  const onlyOut = out.filter((id) => !inc.includes(id));
  const onlyIn = inc.filter((id) => !out.includes(id));
  return (
    <div className="ac-card flex flex-col gap-2.5 px-3.5 py-3" data-graph-detail>
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: colour }} />
        <span className="text-meta font-medium text-text-1">{node.title}</span>
        <span className="ac-mono text-nano text-text-4">
          {node.projectSlug ?? node.scope} · {node.tokens} tok · {node.degree} links{node.kind === 'hub' ? ' · hub' : ''}
        </span>
        <div className="flex-1" />
        <Button size="sm" aria-pressed={pinned} onClick={onTogglePin}>{pinned ? 'Unpin' : 'Pin'}</Button>
        <Button size="sm" variant="primary" onClick={() => onOpen(node.id)}>Open page</Button>
        <Button size="sm" variant="ghost" aria-label="Close the detail panel" onClick={onClose}>Close</Button>
      </div>
      {out.length || inc.length ? (
        <div className="flex flex-col gap-1.5">
          <LinkRow label="links to" ids={onlyOut} model={model} onFocus={onFocus} />
          <LinkRow label="linked from" ids={onlyIn} model={model} onFocus={onFocus} />
          <LinkRow label="links both ways" ids={both} model={model} onFocus={onFocus} />
        </div>
      ) : (
        <span className="text-micro text-text-4">Nothing links to this page yet.</span>
      )}
    </div>
  );
}

function LinkRow({ label, ids, model, onFocus }: { label: string; ids: string[]; model: GraphModel; onFocus: (id: string) => void }): React.ReactElement | null {
  if (!ids.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="ac-label shrink-0">{label}</span>
      {ids.map((id) => (
        <button key={id} type="button" onClick={() => onFocus(id)} className="text-micro text-accent-link hover:underline">
          {model.byId.get(id)?.title ?? id}
        </button>
      ))}
    </div>
  );
}

/**
 * The phone rendering the design contract asks for (§7.4): the selected page, then its neighbours,
 * one hop at a time. The same model the canvas draws, projected into a list.
 */
export function GraphNeighbourList({
  model, selected, onSelect, onOpen, colourOf,
}: {
  model: GraphModel;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (path: string) => void;
  colourOf: (group: string) => string;
}): React.ReactElement {
  const root = (selected && model.byId.get(selected)) || [...model.nodes].sort((a, b) => b.degree - a.degree)[0]!;
  const neighbours = [...(model.neighbours.get(root.id) ?? [])]
    .map((id) => model.byId.get(id))
    .filter((n): n is GraphNode => Boolean(n))
    .sort((a, b) => b.degree - a.degree);

  return (
    <div className="ac-card flex flex-col gap-2 p-3" data-graph-list>
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: colourOf(root.group) }} />
        <span className="text-meta font-medium text-text-1">{root.title}</span>
        <span className="ac-mono text-nano text-text-4">{root.degree} links</span>
        <div className="flex-1" />
        <Button size="sm" variant="primary" onClick={() => onOpen(root.id)}>Open page</Button>
      </div>
      <div className="ac-label">neighbours</div>
      {neighbours.length ? (
        <ul className="flex flex-col">
          {neighbours.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => onSelect(n.id)} className="flex w-full items-center gap-2 py-1.5 text-left text-micro text-text-2 hover:text-text-1">
                <span className="size-2 shrink-0 rounded-full" style={{ background: colourOf(n.group) }} />
                <span className="truncate">{n.title}</span>
                <span className="ac-mono ml-auto shrink-0 text-nano text-text-4">{n.degree}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-micro text-text-4">This page links to nothing yet.</span>
      )}
    </div>
  );
}
