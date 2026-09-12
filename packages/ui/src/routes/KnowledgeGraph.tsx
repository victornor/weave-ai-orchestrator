/**
 * The knowledge graph: hub files and documents as nodes, `[[links]]` as edges, laid out by a live
 * `d3-force` simulation you can drag, zoom, pan, search and filter.
 *
 * Rendering and interaction (pan, zoom, drag) are owned by `@xyflow/react` (VS-267) — it takes over
 * wheel/pinch/drag from the moment the canvas mounts, which a hand-rolled `useEffect`-attached
 * listener never could. `d3-force` still owns the layout: `createSimulation()` is unchanged in its
 * public shape, and its tick output is pushed into React Flow's node state. Edges and cluster hulls
 * are drawn as ordinary React Flow *nodes* rather than through its edge system — see
 * `EdgesLayerNode`'s doc comment for why — positioned at the origin with a `zIndex` that keeps
 * cluster region behind edges behind chips. Everything that can be reasoned about without a DOM —
 * the model, the layout, the geometry, the filters — still lives in `../lib/graph/` and is
 * unit-tested there.
 *
 * A node's *position* is tick-driven (`setNodes` on every `onTick`, rebuilt from `sim.nodes()`).
 * Its *visual* state — dimmed, selected, pinned, label detail, colour — is not: those come from
 * `GraphVisualContext`, updated only when the reader actually does something (search, hover, select,
 * pin, resize), so a hover doesn't wait for the next tick and a settled graph doesn't re-render for
 * no reason. `suppressedLabels()` is the one exception that stays tick-driven and ref-written,
 * exactly as before: it is a narrow backstop for the transient overlap a drag or a reheat can cause
 * before collision has resolved it again, not a per-render concern.
 *
 * Under `prefers-reduced-motion` nothing animates: the layout is settled in one synchronous pass and
 * the viewport moves in one step. Under the phone breakpoint the default is the neighbour list
 * (DESIGN-CONTRACT §7.4), with the canvas one tap away.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  getViewportForBounds,
  type Node,
  type NodeProps,
  type OnMove,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Button } from '../components/Button';
import { useKnowledgeGraph } from '../api/hooks';
import { cx } from '../lib/cx';
import { buildModel, type GraphModel, type GraphNode } from '../lib/graph/model';
import { highlighted, matchingIds, nodeDimmed, visible } from '../lib/graph/filters';
import { chipSize, createSimulation, rectIntersection, suppressedLabels, type GraphSimulation } from '../lib/graph/simulation';
import { hullPath, type Point } from '../lib/graph/hull';

const PALETTE = ['var(--accent)', 'var(--status-done)', 'var(--status-working)', 'var(--status-merging)', 'var(--status-blocked)', 'var(--status-needs-you)'];

/** Used when the frame has not been measured — jsdom has no layout, and neither has a first paint. */
const FALLBACK_SIZE = { width: 900, height: 520 };
/** How far a cluster region is drawn outside the nodes it encloses, in graph units. */
const HULL_PAD = 40;
const VIEW_TWEEN_MS = 260;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;
const DEFAULT_ZOOM = 1;
/** Fraction of the fitted bounds added as margin — React Flow's `fitBounds`/`fitView` padding unit. */
const FIT_PADDING = 0.12;

/** How much of a label to draw. Below `none` only hubs and the focused node are labelled. */
type LabelDetail = 'none' | 'truncated' | 'full';
const LABEL_TRUNCATED_ZOOM = 0.6;
const LABEL_FULL_ZOOM = 1.4;
function labelDetail(k: number): LabelDetail {
  if (k < LABEL_TRUNCATED_ZOOM) return 'none';
  if (k < LABEL_FULL_ZOOM) return 'truncated';
  return 'full';
}

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

// ── the visual context every chip/hull reads, independent of the tick-driven position ────────────

type ChipInfo = Pick<GraphNode, 'kind' | 'title' | 'group' | 'degree'>;

interface GraphVisualContextValue {
  colourOf: (group: string) => string;
  isDimmed: (id: string) => boolean;
  selectedId: string | null;
  hoverId: string | null;
  pins: ReadonlySet<string>;
  detail: LabelDetail;
  /** Where `suppressedLabels()`'s tick-driven opacity is written directly, bypassing React. */
  nodeRefs: React.RefObject<Map<string, SVGSVGElement>>;
}

const GraphVisualContext = createContext<GraphVisualContextValue | null>(null);

function useGraphVisual(): GraphVisualContextValue {
  const ctx = useContext(GraphVisualContext);
  if (!ctx) throw new Error('Graph chip/hull rendered outside GraphVisualContext');
  return ctx;
}

/** What a node's label says at this zoom. A hub, and whatever is focused, is always named. */
function labelFor(node: Pick<GraphNode, 'kind' | 'title'>, detail: LabelDetail, focused: boolean): string | null {
  if (detail === 'none' && node.kind !== 'hub' && !focused) return null;
  if (detail === 'full' || focused) return node.title;
  return node.title.length > 26 ? `${node.title.slice(0, 24)}…` : node.title;
}

// ── React Flow node/edge types ─────────────────────────────────────────────────────────────────

type ChipNodeType = Node<{ chip: ChipInfo }, 'chip'>;
type HullNodeType = Node<{ group: string; d: string | null }, 'hull'>;
type GraphNodeType = ChipNodeType | HullNodeType | EdgesLayerNodeType;

function KnowledgeChipNode({ id, data }: NodeProps<ChipNodeType>): React.ReactElement {
  const { colourOf, isDimmed, selectedId, hoverId, pins, detail, nodeRefs } = useGraphVisual();
  const { chip } = data;
  const { width, height } = chipSize(chip);
  const selected = selectedId === id;
  const hovered = hoverId === id;
  const pinned = pins.has(id);
  const dimmed = isDimmed(id);
  const label = labelFor(chip, detail, selected || hovered);
  const colour = colourOf(chip.group);

  return (
    <svg
      ref={(el) => {
        if (el) nodeRefs.current.set(id, el);
        else nodeRefs.current.delete(id);
      }}
      data-node={id}
      data-chip=""
      data-kind={chip.kind}
      data-dimmed={dimmed ? 'true' : undefined}
      data-pinned={pinned ? 'true' : undefined}
      width={width}
      height={height}
      className="cursor-pointer overflow-visible"
      opacity={dimmed ? 0.22 : 1}
      role="button"
      tabIndex={0}
      aria-label={chip.title}
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={4}
        fill="var(--bg-1)"
        stroke={selected ? 'var(--text-1)' : 'var(--line-2)'}
        strokeWidth={selected ? 2 : 1}
      />
      <rect x={0} y={0} width={3} height={height} rx={1} fill={colour} />
      {label ? (
        <text
          x={width / 2 + 1.5}
          y={height / 2}
          dominantBaseline="central"
          textAnchor="middle"
          fontSize="var(--fs-micro)"
          fill="var(--text-1)"
          className={cx('pointer-events-none', chip.kind === 'hub' && 'font-semibold')}
        >
          {label}
        </text>
      ) : null}
      {pinned ? <circle cx={width - 5} cy={5} r={3} fill="var(--text-1)" stroke="var(--bg-0)" strokeWidth={1} /> : null}
    </svg>
  );
}

function HullNode({ data }: NodeProps<HullNodeType>): React.ReactElement | null {
  const { colourOf } = useGraphVisual();
  if (!data.d) return null;
  const colour = colourOf(data.group);
  return (
    <svg className="overflow-visible" style={{ width: 1, height: 1 }} aria-hidden="true">
      <path d={data.d} fill={colour} fillOpacity={0.07} stroke={colour} strokeOpacity={0.18} strokeWidth={1.5} />
    </svg>
  );
}

/**
 * All edges as a single overlay node (VS-267), not React Flow's own edge system: RF's edge
 * renderer requires a node's `handleBounds` to be measured before it will draw anything touching
 * it, and in this canvas — no visible `<Handle>`, no user-drawn connections, only display lines
 * with their own computed geometry — that measurement pass never completed in testing against a
 * real browser render, so no edge ever appeared. Drawing edges the same way hulls are drawn (a
 * `zIndex`-ordered node, positioned at the origin, painting an absolute-coordinate SVG that React
 * Flow does not clip) sidesteps that system entirely and keeps edges on the same tick-driven,
 * pure-geometry footing as everything else in this file. `zIndex` between the hulls (-1) and the
 * chips (1) keeps edges behind chips and in front of cluster regions, matching the existing
 * "cluster region, then edges, then nodes" layering.
 */
type EdgesLayerNodeType = Node<{ paths: EdgePathInfo[] }, 'edges'>;

interface EdgePathInfo {
  id: string;
  d: string;
  directed: boolean;
  dimmed: boolean;
}

function EdgesLayerNode({ data }: NodeProps<EdgesLayerNodeType>): React.ReactElement {
  return (
    <svg className="overflow-visible" style={{ width: 1, height: 1 }} aria-hidden="true">
      <defs>
        <marker id="ac-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--line-3)" />
        </marker>
      </defs>
      {data.paths.map((p) => (
        <path
          key={p.id}
          data-edge={p.id}
          d={p.d}
          fill="none"
          stroke="var(--line-3)"
          strokeWidth={p.dimmed ? 0.8 : 1.6}
          strokeOpacity={p.dimmed ? 0.25 : 0.85}
          markerEnd={p.directed ? 'url(#ac-graph-arrow)' : undefined}
        />
      ))}
    </svg>
  );
}

/** Computes one edge's SVG path, trimmed to each chip's real rectangle boundary (VS-267), not a
 *  circumscribed circle — the fix for edges that used to stop short of the visible chip. */
function edgePathFor(s: { x: number; y: number } & ChipInfo, t: { x: number; y: number } & ChipInfo, directed: boolean): string {
  const sSize = chipSize(s);
  const tSize = chipSize(t);
  const from = rectIntersection(s.x, s.y, sSize.width / 2, sSize.height / 2, t.x, t.y);
  const to = rectIntersection(t.x, t.y, tSize.width / 2, tSize.height / 2, s.x, s.y);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const gap = directed ? 4 : 1;
  const endX = to.x - (dx / len) * gap;
  const endY = to.y - (dy / len) * gap;

  return `M${round(from.x)} ${round(from.y)}L${round(endX)} ${round(endY)}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

const NODE_TYPES = { chip: KnowledgeChipNode, hull: HullNode, edges: EdgesLayerNode };

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
  const [nodes, setNodes] = useState<GraphNodeType[]>([]);

  const model = useMemo(() => (graph.data ? buildModel(graph.data) : null), [graph.data]);
  const shown = useMemo(() => (model ? visible(model, hidden) : null), [model, hidden]);
  const matches = useMemo(() => (model ? matchingIds(model, query) : null), [model, query]);
  const lit = useMemo(() => (shown ? highlighted(shown, hover ?? selected) : null), [shown, hover, selected]);
  const colourOf = useCallback((group: string): string => PALETTE[Math.max(0, model?.groups.indexOf(group) ?? 0) % PALETTE.length]!, [model]);
  const isDimmed = useCallback((id: string): boolean => nodeDimmed(id, lit, matches), [lit, matches]);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const frameObserverRef = useRef<ResizeObserver | null>(null);
  const simRef = useRef<GraphSimulation | null>(null);
  const rfRef = useRef<ReactFlowInstance<GraphNodeType> | null>(null);
  const sizeRef = useRef(FALLBACK_SIZE);
  const autoFitRef = useRef(true);
  const nodeRefs = useRef(new Map<string, SVGSVGElement>());
  // `draw` is bound to the simulation's tick event once, at creation, so it must read hover and
  // selection through refs — a state closure captured at that moment would go stale the instant
  // the reader hovers or selects something without the simulation itself being recreated.
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const litRef = useRef<ReadonlySet<string> | null>(null);
  const matchesRef = useRef<ReadonlySet<string> | null>(null);

  const measure = useCallback((): { width: number; height: number } => {
    const el = frameRef.current;
    const width = el?.clientWidth || FALLBACK_SIZE.width;
    const height = el?.clientHeight || FALLBACK_SIZE.height;
    sizeRef.current = { width, height };
    return sizeRef.current;
  }, []);

  /** The one place geometry reaches React state: called on every simulation tick. */
  const draw = useCallback((): void => {
    const sim = simRef.current;
    if (!sim) return;
    const simNodes = sim.nodes();

    // The backstop: whatever the layout itself does not (yet) keep apart — mid-drag, mid-reheat —
    // at most one overlapping chip's label is drawn, written straight to the DOM so a drag sees the
    // verdict immediately rather than waiting on React. O(n²) over the chip count, same order as
    // the collide force already pays every tick at this graph's supported scale.
    const keep = new Set<string>();
    if (hoverRef.current) keep.add(hoverRef.current);
    if (selectedRef.current) keep.add(selectedRef.current);
    const suppressed = suppressedLabels(simNodes, keep);
    for (const n of simNodes) {
      const el = nodeRefs.current.get(n.id);
      if (el) el.style.opacity = suppressed.has(n.id) ? '0.22' : '';
    }

    const byGroup = new Map<string, Point[]>();
    for (const n of simNodes) {
      const points = byGroup.get(n.group) ?? [];
      points.push({ x: n.x, y: n.y });
      byGroup.set(n.group, points);
    }

    const chipNodes: ChipNodeType[] = simNodes.map((n) => {
      const { width, height } = chipSize(n);
      return {
        id: n.id,
        type: 'chip',
        position: { x: n.x - width / 2, y: n.y - height / 2 },
        width,
        height,
        draggable: true,
        selectable: false,
        connectable: false,
        zIndex: 1,
        data: { chip: { kind: n.kind, title: n.title, group: n.group, degree: n.degree } },
      };
    });
    const hullNodes: HullNodeType[] = [...byGroup.entries()].map(([group, points]) => ({
      id: `hull:${group}`,
      type: 'hull',
      position: { x: 0, y: 0 },
      // React Flow marks a node `visibility: hidden` until it has *some* declared or measured
      // size (`nodeHasDimensions`) — without this, a node with no ResizeObserver-measured content
      // (this one paints entirely outside its own 0×0 box) stays invisible forever. Confirmed
      // against a real browser render, not just a jsdom assumption.
      width: 1,
      height: 1,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -1,
      data: { group, d: hullPath(points, HULL_PAD) },
    }));

    // Edges, drawn as one overlay node rather than React Flow's own edge system — see
    // `EdgesLayerNode`'s doc comment for why. `sim.links()` already resolves `source`/`target` to
    // the live SimNode objects (d3-force's own behaviour once `.links()` has initialized them),
    // so this reads the same tick-fresh positions the chips above were just built from.
    const lit = litRef.current;
    const matches = matchesRef.current;
    const isEdgeEndDimmed = (id: string): boolean => (!!lit && !lit.has(id)) || (!!matches && !matches.has(id));
    const paths: EdgePathInfo[] = [];
    for (const link of sim.links()) {
      const s = link.source;
      const t = link.target;
      if (typeof s !== 'object' || typeof t !== 'object') continue;
      paths.push({
        id: link.id,
        d: edgePathFor(s, t, link.directed),
        directed: link.directed,
        dimmed: isEdgeEndDimmed(s.id) || isEdgeEndDimmed(t.id),
      });
    }
    const edgesLayer: EdgesLayerNodeType = {
      id: 'edges-layer',
      type: 'edges',
      position: { x: 0, y: 0 },
      width: 1,
      height: 1,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: 0,
      data: { paths },
    };

    setNodes([...hullNodes, edgesLayer, ...chipNodes]);

    if (autoFitRef.current) fitToDefault(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fit the viewport to the current chip bounds, floored at `DEFAULT_ZOOM` so titles stay legible. */
  const fitToDefault = useCallback((animate: boolean): void => {
    const sim = simRef.current;
    const rf = rfRef.current;
    if (!sim || !rf) return;
    const chipIds = sim.nodes().map((n) => n.id);
    if (chipIds.length === 0) return;
    const bounds = rf.getNodesBounds(chipIds);
    const size = sizeRef.current;
    const fitted = getViewportForBounds(bounds, size.width, size.height, MIN_ZOOM, MAX_ZOOM, FIT_PADDING);
    const zoom = Math.max(fitted.zoom, DEFAULT_ZOOM);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const x = size.width / 2 - cx * zoom;
    const y = size.height / 2 - cy * zoom;
    void rf.setViewport({ x, y, zoom }, { duration: animate ? VIEW_TWEEN_MS : 0 });
  }, []);

  // The simulation: created once per motion preference, updated whenever the visible graph changes.
  const animatedRef = useRef(animated);
  useEffect(() => {
    if (!shown) return;
    measure();
    if (simRef.current && animatedRef.current !== animated) {
      simRef.current.destroy();
      simRef.current = null;
    }
    animatedRef.current = animated;
    let sim = simRef.current;
    if (!sim) {
      sim = createSimulation(shown, sizeRef.current, { animated });
      simRef.current = sim;
      sim.onTick(draw);
      sim.start(1);
    } else {
      sim.update(shown, sizeRef.current);
    }
    draw();
    setPins(new Set(sim.pinned()));
  }, [shown, animated, draw, measure]);

  useEffect(() => () => {
    simRef.current?.destroy();
    simRef.current = null;
  }, []);

  useEffect(() => {
    const onResize = (): void => {
      measure();
      if (autoFitRef.current) fitToDefault(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure, fitToDefault]);

  /**
   * The frame is conditionally mounted — on phone it does not exist until the reader switches
   * from the default neighbour list to the canvas — so a `resize` listener alone never fires for
   * that transition and `sizeRef` is left holding `FALLBACK_SIZE` forever. A callback ref measures
   * the frame the moment it exists, and a `ResizeObserver` keeps that measurement correct
   * afterwards, without depending on the window ever resizing.
   */
  const attachFrame = useCallback((el: HTMLDivElement | null): void => {
    frameRef.current = el;
    frameObserverRef.current?.disconnect();
    frameObserverRef.current = null;
    if (!el) return;
    measure();
    if (autoFitRef.current) fitToDefault(false);
    const observer = new ResizeObserver(() => {
      measure();
      if (autoFitRef.current) fitToDefault(false);
    });
    observer.observe(el);
    frameObserverRef.current = observer;
  }, [measure, fitToDefault]);

  useEffect(() => () => frameObserverRef.current?.disconnect(), []);

  useEffect(() => { setSelected(null); }, [project]);
  useEffect(() => { hoverRef.current = hover; }, [hover]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { litRef.current = lit; }, [lit]);
  useEffect(() => { matchesRef.current = matches; }, [matches]);

  const focusNode = useCallback((id: string): void => {
    const rf = rfRef.current;
    const n = simRef.current?.node(id);
    if (!rf || !n) return;
    autoFitRef.current = false;
    const { zoom } = rf.getViewport();
    const size = sizeRef.current;
    void rf.setViewport({ x: size.width / 2 - n.x * zoom, y: size.height / 2 - n.y * zoom, zoom }, { duration: VIEW_TWEEN_MS });
  }, []);

  // A search that lands on exactly one page brings it into view.
  useEffect(() => {
    if (!matches || matches.size !== 1) return;
    const [only] = matches;
    if (only) focusNode(only);
  }, [matches, focusNode]);

  const fitView = useCallback((): void => {
    autoFitRef.current = false;
    fitToDefault(animated);
  }, [fitToDefault, animated]);

  const resetView = useCallback((): void => {
    autoFitRef.current = false;
    fitToDefault(animated);
  }, [fitToDefault, animated]);

  /**
   * Zoom about the frame centre by `factor`, via `setViewport` rather than React Flow's own
   * `zoomIn`/`zoomOut` (`panZoom.scaleBy`). `setViewport` is the same call `fitToDefault` already
   * uses for Fit/Reset/the initial default view, so it shares one proven-reliable path instead of
   * a second one — and it gives an exact, `ZOOM_STEP`-matching factor instead of `zoomIn`/`zoomOut`'s
   * fixed internal 1.2.
   */
  const zoomBy = useCallback((factor: number): void => {
    const rf = rfRef.current;
    if (!rf) return;
    autoFitRef.current = false;
    const { x, y, zoom } = rf.getViewport();
    const size = sizeRef.current;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const gx = (cx - x) / zoom;
    const gy = (cy - y) / zoom;
    void rf.setViewport(
      { x: cx - gx * nextZoom, y: cy - gy * nextZoom, zoom: nextZoom },
      { duration: animated ? VIEW_TWEEN_MS : 0 },
    );
  }, [animated]);

  const togglePin = useCallback((id: string): void => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.isPinned(id)) sim.unpin(id);
    else sim.pin(id);
    setPins(new Set(sim.pinned()));
  }, []);

  const selectNode = useCallback((id: string): void => {
    setSelected(id);
  }, []);

  const onMove = useCallback<OnMove>((event, viewport) => {
    if (event) autoFitRef.current = false;
    setDetail((was) => {
      const now = labelDetail(viewport.zoom);
      return now === was ? was : now;
    });
  }, []);

  const onNodeClick = useCallback((_event: unknown, node: GraphNodeType): void => {
    if (node.type === 'chip') selectNode(node.id);
  }, [selectNode]);

  const onNodeDoubleClick = useCallback((_event: unknown, node: GraphNodeType): void => {
    if (node.type === 'chip') onOpen(node.id);
  }, [onOpen]);

  const onNodeMouseEnter = useCallback((_event: unknown, node: GraphNodeType): void => {
    if (node.type === 'chip') setHover(node.id);
  }, []);

  const onNodeMouseLeave = useCallback((_event: unknown, node: GraphNodeType): void => {
    if (node.type === 'chip') setHover((was) => (was === node.id ? null : was));
  }, []);

  const onNodeDragStart = useCallback((): void => {
    autoFitRef.current = false;
  }, []);

  const onNodeDrag = useCallback((_event: unknown, node: GraphNodeType): void => {
    if (node.type !== 'chip') return;
    const { width, height } = chipSize(node.data.chip);
    simRef.current?.drag(node.id, node.position.x + width / 2, node.position.y + height / 2);
  }, []);

  const onNodeDragStop = useCallback((_event: unknown, node: GraphNodeType): void => {
    if (node.type === 'chip') simRef.current?.endDrag(node.id);
  }, []);

  const visualContext = useMemo<GraphVisualContextValue>(() => ({
    colourOf, isDimmed, selectedId: selected, hoverId: hover, pins, detail, nodeRefs,
  }), [colourOf, isDimmed, selected, hover, pins, detail]);


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
            <Button size="sm" onClick={() => zoomBy(1.25)}>Zoom in</Button>
            <Button size="sm" onClick={() => zoomBy(1 / 1.25)}>Zoom out</Button>
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
        <div ref={attachFrame} className="ac-card relative overflow-hidden p-0">
          <div className="h-[32rem] w-full" aria-label="Knowledge graph">
            <GraphVisualContext.Provider value={visualContext}>
              <ReactFlow<GraphNodeType>
                nodes={nodes}
                edges={[]}
                nodeTypes={NODE_TYPES}
                onInit={(instance) => { rfRef.current = instance; }}
                onMove={onMove}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeMouseEnter={onNodeMouseEnter}
                onNodeMouseLeave={onNodeMouseLeave}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                defaultViewport={{ x: 0, y: 0, zoom: DEFAULT_ZOOM }}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnDoubleClick={false}
                nodeClickDistance={4}
                proOptions={{ hideAttribution: true }}
              />
            </GraphVisualContext.Provider>
          </div>
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
