/**
 * The knowledge graph: hub files and documents as nodes, `[[links]]` as edges, laid out by a live
 * `d3-force` simulation you can drag, zoom, pan, search and filter — drawn on a `<canvas>` by
 * `react-force-graph-2d` (VS-280), which owns wheel/pinch/drag/pan itself rather than those being
 * hand-built or routed through a DOM node-editor. See
 * `openspec/changes/vs-280-rebuild-the-knowledge-graph-on-a-canvas/design.md` for why.
 *
 * A node is a circle sized by its degree and filled with its group's colour (no cluster hulls —
 * the colour alone carries "which pages belong together", per the same design doc). Everything
 * that can be reasoned about without a canvas — the model, the filters, node geometry, the
 * group-clustering force — lives in `../lib/graph/` and is unit-tested there; this file wires that
 * to `react-force-graph-2d`'s callbacks.
 *
 * Canvas 2D cannot resolve a CSS custom property (`ctx.fillStyle = 'var(--x)'` is not a colour),
 * so the app's design tokens are read once via `getComputedStyle` and re-read whenever the
 * `data-theme` attribute changes (`useThemeColours` below) — the one place this file talks to the
 * DOM rather than to `react-force-graph-2d`'s own props.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Button } from '../components/Button';
import { useKnowledgeGraph, useProjects } from '../api/hooks';
import { cx } from '../lib/cx';
import { projectLabelFor } from '../lib/projectName';
import { buildModel, type GraphModel, type GraphNode } from '../lib/graph/model';
import { highlighted, matchingIds, nodeDimmed, visible } from '../lib/graph/filters';
import { centeringForce, clusterForce } from '../lib/graph/cluster';
import { circleIntersection, linksFor, reconcileNodes, suppressedLabels, type CanvasLink, type CanvasNode } from '../lib/graph/nodes';

const PALETTE_VARS = ['--accent', '--status-done', '--status-working', '--status-merging', '--status-blocked', '--status-needs-you'];

/** Used when the frame has not been measured — jsdom has no layout, and neither has a first paint. */
const FALLBACK_SIZE = { width: 900, height: 520 };
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;
const DEFAULT_ZOOM = 1;
const VIEW_TWEEN_MS = 260;
const FIT_PADDING = 48;
/** Ticks a synchronous settle runs under reduced motion. Enough for alpha to decay to rest. */
const SETTLE_TICKS = 320;
const CLUSTER_STRENGTH = 0.08;
const CENTER_STRENGTH = 0.02;
const DOUBLE_CLICK_MS = 350;
const LABEL_FONT_PX = 5.5;

/** How much of a label to draw. Below `none` only hubs and the focused node are labelled. */
type LabelDetail = 'none' | 'truncated' | 'full';
const LABEL_TRUNCATED_ZOOM = 0.6;
const LABEL_FULL_ZOOM = 1.4;
function labelDetail(k: number): LabelDetail {
  if (k < LABEL_TRUNCATED_ZOOM) return 'none';
  if (k < LABEL_FULL_ZOOM) return 'truncated';
  return 'full';
}

/** What a node's label says at this zoom. A hub, and whatever is focused, is always named. */
function labelFor(kind: GraphNode['kind'], title: string, detail: LabelDetail, focused: boolean): string | null {
  if (detail === 'none' && kind !== 'hub' && !focused) return null;
  if (detail === 'full' || focused) return title;
  return title.length > 26 ? `${title.slice(0, 24)}…` : title;
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

interface ThemeColours {
  group: string[];
  text1: string;
  line3: string;
}

function readThemeColours(el: Element): ThemeColours {
  const style = getComputedStyle(el);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    group: PALETTE_VARS.map((name) => read(name, '#5e6ad2')),
    text1: read('--text-1', '#e6e6e6'),
    line3: read('--line-3', '#666'),
  };
}

/** Reads the app's design tokens once, and again whenever the theme switches. Not React state:
 *  a canvas repaint is driven by bumping `tick`, which changes the paint callbacks' identity. */
function useThemeColours(el: Element | null): { colours: React.RefObject<ThemeColours>; tick: number } {
  const colours = useRef<ThemeColours>({ group: [], text1: '#e6e6e6', line3: '#666' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!el) return;
    colours.current = readThemeColours(el);
    const observer = new MutationObserver(() => {
      colours.current = readThemeColours(el);
      setTick((t) => t + 1);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [el]);
  return { colours, tick };
}

export function KnowledgeGraphView({ project, onOpen }: { project?: string; onOpen: (path: string) => void }): React.ReactElement {
  const graph = useKnowledgeGraph(project);
  const graphProjects = useProjects();
  // A group is a project slug or a scope word; name it by the project's label where it is one.
  const groupLabel = (g: string): string => projectLabelFor(graphProjects.data, { slug: g }) ?? g;
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery('(max-width: 640px)');
  const animated = !reduced;

  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pins, setPins] = useState<ReadonlySet<string>>(() => new Set());
  const [canvasView, setCanvasView] = useState(false);
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [graphData, setGraphData] = useState<{ nodes: CanvasNode[]; links: CanvasLink[] }>({ nodes: [], links: [] });

  const model = useMemo(() => (graph.data ? buildModel(graph.data) : null), [graph.data]);
  const shown = useMemo(() => (model ? visible(model, hidden) : null), [model, hidden]);
  const matches = useMemo(() => (model ? matchingIds(model, query) : null), [model, query]);
  const lit = useMemo(() => (shown ? highlighted(shown, hover ?? selected) : null), [shown, hover, selected]);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const frameObserverRef = useRef<ResizeObserver | null>(null);
  const fgRef = useRef<ForceGraphMethods<CanvasNode, CanvasLink> | undefined>(undefined);
  const autoFitRef = useRef(true);
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);

  // `nodeCanvasObject`/`linkCanvasObject` run every animation frame, long after the render that
  // set hover/selection — a state closure captured then would go stale the instant the reader
  // hovers or selects something without the simulation itself restarting.
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const litRef = useRef<ReadonlySet<string> | null>(null);
  const matchesRef = useRef<ReadonlySet<string> | null>(null);
  const suppressedRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => { hoverRef.current = hover; }, [hover]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { litRef.current = lit; }, [lit]);
  useEffect(() => { matchesRef.current = matches; }, [matches]);

  const { colours, tick: coloursTick } = useThemeColours(frameRef.current);

  const colourOf = useCallback((group: string): string => {
    const palette = colours.current.group;
    if (palette.length === 0) return '#5e6ad2';
    const idx = Math.max(0, model?.groups.indexOf(group) ?? 0);
    return palette[idx % palette.length]!;
  }, [model, colours]);

  const measure = useCallback((): void => {
    const el = frameRef.current;
    setSize({ width: el?.clientWidth || FALLBACK_SIZE.width, height: el?.clientHeight || FALLBACK_SIZE.height });
  }, []);

  // Reconcile the model into stable CanvasNode/CanvasLink objects only when the *visible* model
  // changes (a group hidden/shown, or a refetch) — never on hover/select/search, so those never
  // touch `graphData` identity and never reheat or reposition the layout.
  const graphDataRef = useRef(graphData);
  useEffect(() => {
    if (!shown) return;
    const centre = { x: size.width / 2, y: size.height / 2 };
    const next = { nodes: reconcileNodes(graphDataRef.current.nodes, shown, centre), links: linksFor(shown) };
    graphDataRef.current = next;
    setGraphData(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const refit = useCallback((): void => {
    const fg = fgRef.current;
    if (!fg || !autoFitRef.current) return;
    fg.zoomToFit(0, FIT_PADDING);
    if (fg.zoom() < DEFAULT_ZOOM) fg.zoom(DEFAULT_ZOOM);
  }, []);

  // `onEngineStop` alone is not enough: `react-force-graph-2d`'s default `cooldownTime` is 15s, so
  // waiting for it leaves the reader looking at an unfit view (nodes seeded near the frame centre,
  // spreading outward under the charge/link forces with nothing re-framing them) for up to 15
  // real seconds after every open — confirmed visually before this was added. Refitting on every
  // tick, the same way the pre-VS-280 renderer's `draw()` did, keeps the view tracking the
  // expanding bounds as the layout unfolds instead of only correcting it once at the very end.
  const tickCountRef = useRef(0);
  const onEngineTick = useCallback((): void => {
    tickCountRef.current += 1;
    if (tickCountRef.current % 3 !== 0) return;
    refit();
  }, [refit]);
  const onEngineStop = refit;

  const onRenderFramePre = useCallback((): void => {
    const keep = new Set<string>();
    if (hoverRef.current) keep.add(hoverRef.current);
    if (selectedRef.current) keep.add(selectedRef.current);
    suppressedRef.current = suppressedLabels(graphDataRef.current.nodes, keep);
  }, []);

  const nodeCanvasObject = useCallback((n: CanvasNode, ctx: CanvasRenderingContext2D, globalScale: number): void => {
    const dimmed = nodeDimmed(n.id, litRef.current, matchesRef.current);
    const focused = selectedRef.current === n.id || hoverRef.current === n.id;

    ctx.globalAlpha = dimmed ? 0.22 : 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fillStyle = colourOf(n.group);
    ctx.fill();
    if (focused) {
      ctx.lineWidth = 1.5 / globalScale;
      ctx.strokeStyle = colours.current.text1;
      ctx.stroke();
    }

    const label = suppressedRef.current.has(n.id) ? null : labelFor(n.kind, n.title, labelDetail(globalScale), focused);
    if (label) {
      ctx.font = `${n.kind === 'hub' ? 'bold ' : ''}${LABEL_FONT_PX}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colours.current.text1;
      ctx.fillText(label, n.x + n.radius + 1.5, n.y);
    }
    ctx.globalAlpha = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colourOf, coloursTick]);

  const nodePointerAreaPaint = useCallback((n: CanvasNode, color: string, ctx: CanvasRenderingContext2D): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const linkCanvasObject = useCallback((link: CanvasLink, ctx: CanvasRenderingContext2D): void => {
    const s = link.source as unknown as CanvasNode;
    const t = link.target as unknown as CanvasNode;
    if (typeof s !== 'object' || typeof t !== 'object') return;
    const dimmed = nodeDimmed(s.id, litRef.current, matchesRef.current) || nodeDimmed(t.id, litRef.current, matchesRef.current);
    const from = circleIntersection(s.x, s.y, s.radius, t.x, t.y);
    const to = circleIntersection(t.x, t.y, t.radius, s.x, s.y);

    ctx.globalAlpha = dimmed ? 0.25 : 0.85;
    ctx.strokeStyle = colours.current.line3;
    ctx.lineWidth = dimmed ? 0.8 : 1.4;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    if (link.directed) {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const size2 = 4.5;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - size2 * Math.cos(angle - Math.PI / 6), to.y - size2 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(to.x - size2 * Math.cos(angle + Math.PI / 6), to.y - size2 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = colours.current.line3;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coloursTick]);

  const focusNode = useCallback((id: string): void => {
    const fg = fgRef.current;
    const n = graphDataRef.current.nodes.find((x) => x.id === id);
    if (!fg || !n) return;
    autoFitRef.current = false;
    fg.centerAt(n.x, n.y, animated ? VIEW_TWEEN_MS : 0);
  }, [animated]);

  // A search that lands on exactly one page brings it into view.
  useEffect(() => {
    if (!matches || matches.size !== 1) return;
    const [only] = matches;
    if (only) focusNode(only);
  }, [matches, focusNode]);

  const togglePin = useCallback((id: string): void => {
    const n = graphDataRef.current.nodes.find((x) => x.id === id);
    if (!n) return;
    if (n.fx != null || n.fy != null) {
      n.fx = undefined;
      n.fy = undefined;
    } else {
      n.fx = n.x;
      n.fy = n.y;
    }
    setPins(new Set(graphDataRef.current.nodes.filter((x) => x.fx != null).map((x) => x.id)));
    fgRef.current?.d3ReheatSimulation();
  }, []);

  const onNodeClick = useCallback((n: CanvasNode): void => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.id === n.id && now - last.t < DOUBLE_CLICK_MS) {
      lastClickRef.current = null;
      onOpen(n.id);
      return;
    }
    lastClickRef.current = { id: n.id, t: now };
    setSelected(n.id);
  }, [onOpen]);

  const onNodeHover = useCallback((n: CanvasNode | null): void => {
    setHover(n ? n.id : null);
  }, []);

  const onNodeDrag = useCallback((): void => {
    autoFitRef.current = false;
  }, []);

  /**
   * The frame is conditionally mounted — on phone it does not exist until the reader switches
   * from the default neighbour list to the canvas — so a plain `resize` listener never fires for
   * that transition. A callback ref measures the frame the moment it exists, a `ResizeObserver`
   * keeps it correct afterwards, and a raw listener on the canvas itself (react-force-graph-2d's
   * own gestures already do the zooming/panning; this only observes that one happened) stops the
   * auto-fit-on-settle behaviour the moment the reader does anything themselves.
   */
  const attachFrame = useCallback((el: HTMLDivElement | null): void => {
    frameRef.current = el;
    frameObserverRef.current?.disconnect();
    frameObserverRef.current = null;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    frameObserverRef.current = observer;
  }, [measure]);

  useEffect(() => () => frameObserverRef.current?.disconnect(), []);

  useEffect(() => {
    const root = frameRef.current;
    const canvasEl = root?.querySelector('canvas');
    if (!canvasEl) return;
    const stop = (): void => { autoFitRef.current = false; };
    // Capture phase: `force-graph`'s own d3-zoom/d3-drag wheel/pointer handling calls
    // `stopImmediatePropagation`, which would otherwise stop a same-phase (bubble) listener on
    // this same element from ever running — confirmed directly (a bubble-phase test listener on
    // the same canvas never fired for a real wheel event) before switching to capture.
    canvasEl.addEventListener('wheel', stop, { passive: true, capture: true });
    canvasEl.addEventListener('pointerdown', stop, { capture: true });
    return () => {
      canvasEl.removeEventListener('wheel', stop, { capture: true });
      canvasEl.removeEventListener('pointerdown', stop, { capture: true });
    };
  }, [phone, canvasView, graphData]);

  useEffect(() => { setSelected(null); }, [project]);

  const clusterForceFn = useMemo(() => clusterForce(CLUSTER_STRENGTH), []);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('cluster', clusterForceFn);
    // Replace react-force-graph-2d's default `center` force (recentres the whole mean every
    // tick, dragging every node whenever one is pinned) with the same weak pull-to-a-point the
    // pre-VS-280 renderer used — otherwise different groups' clusters drift apart with nothing
    // bounding the overall spread. See `lib/graph/cluster.ts`'s `centeringForce` doc comment.
    fg.d3Force('center', null);
    fg.d3Force('centre', centeringForce(size.width / 2, size.height / 2, CENTER_STRENGTH));
  }, [clusterForceFn, graphData, size]);

  // ── render ─────────────────────────────────────────────────────────────────────────────────────

  if (graph.isLoading) return <SkeletonRows rows={6} />;
  if (graph.isError) return <ErrorState code="KNOWLEDGE_GRAPH_FAILED" message="The graph could not be built." onRetry={() => void graph.refetch()} />;
  if (!model || !model.nodes.length || !shown) return <EmptyState title="Nothing to draw yet." detail="The graph fills in as documents are written and linked." />;

  const asList = phone && !canvasView;
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
        {phone ? (
          <Button size="sm" onClick={() => setCanvasView((v) => !v)}>{canvasView ? 'List' : 'Canvas'}</Button>
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
              {groupLabel(g)}
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
            <ForceGraph2D<CanvasNode, CanvasLink>
              ref={fgRef}
              graphData={graphData}
              width={size.width}
              height={size.height}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              warmupTicks={reduced ? SETTLE_TICKS : 0}
              cooldownTicks={reduced ? 0 : undefined}
              nodeCanvasObject={nodeCanvasObject}
              nodeCanvasObjectMode={() => 'replace'}
              nodePointerAreaPaint={nodePointerAreaPaint}
              linkCanvasObject={linkCanvasObject}
              linkCanvasObjectMode={() => 'replace'}
              onRenderFramePre={onRenderFramePre}
              onEngineTick={onEngineTick}
              onEngineStop={onEngineStop}
              onNodeClick={onNodeClick}
              onNodeHover={onNodeHover}
              onNodeDrag={onNodeDrag}
              onDagError={undefined}
            />
          </div>
        </div>
      )}

      {sel ? (
        <GraphDetailPanel
          model={model}
          node={sel}
          pinned={pins.has(sel.id)}
          colour={colourOf(sel.group)}
          projects={graphProjects.data}
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
  model, node, pinned, colour, projects, onOpen, onFocus, onTogglePin, onClose,
}: {
  model: GraphModel;
  node: GraphNode;
  pinned: boolean;
  colour: string;
  /** The workspace's projects, so a project node is named by its display label (VS-330). */
  projects?: Parameters<typeof projectLabelFor>[0];
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
          {node.projectSlug ? (projectLabelFor(projects, { slug: node.projectSlug }) ?? node.projectSlug) : node.scope} · {node.tokens} tok · {node.degree} links{node.kind === 'hub' ? ' · hub' : ''}
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
