/**
 * The V2 Knowledge frame (VS-371): V1's five Knowledge tabs — Knowledge · Explorer · Changelog ·
 * Graph · Specs — as links under the 38px header, plus the project picker that scopes every tab.
 *
 * Each tab is its own route, so the address reflects it and reload / back / forward work. The
 * `?project=` scope is carried into every tab link, so switching tabs keeps the chosen project, as
 * V1's in-page tab state does. The rail's Knowledge row stays highlighted on all five, because they
 * all live under `/v2/w/$ws/knowledge` (`activeNavKey`).
 */
import type { ReactNode } from 'react';
import { A, useGo, useSearchParams } from '../../app/link';
import { useWs } from '../../api/context';
import { useProjects } from '../../api/hooks';
import { cx } from '../../lib/cx';
import { V2Page } from '../V2Page';

export type KnowledgeTab = 'knowledge' | 'explorer' | 'changelog' | 'graph' | 'specs';

/** V1's order (`packages/ui/src/routes/Knowledge.tsx`). */
export const KNOWLEDGE_TABS: ReadonlyArray<{ key: KnowledgeTab; label: string; path: string }> = [
  { key: 'knowledge', label: 'Knowledge', path: '/v2/w/$ws/knowledge' },
  { key: 'explorer', label: 'Explorer', path: '/v2/w/$ws/knowledge/explorer' },
  { key: 'changelog', label: 'Changelog', path: '/v2/w/$ws/knowledge/changelog' },
  { key: 'graph', label: 'Graph', path: '/v2/w/$ws/knowledge/graph' },
  { key: 'specs', label: 'Specs', path: '/v2/w/$ws/knowledge/specs' },
];

/** The address of a tab, for the project picker to stay on the tab it scopes. */
export function knowledgeTabPath(tab: KnowledgeTab): string {
  return KNOWLEDGE_TABS.find((t) => t.key === tab)?.path ?? '/v2/w/$ws/knowledge';
}

/** The current `?project=` scope, as every Knowledge body reads it. */
export function useProjectScope(): string {
  return useSearchParams()['project'] ?? '';
}

export function KnowledgeTabs({ current }: { current: KnowledgeTab }): React.ReactElement {
  const url = useSearchParams();
  const ws = useWs();
  const project = url['project'];
  // Carrying the scope keeps a chosen project across a tab switch; with none, the tab is unscoped.
  const search = project ? { project } : {};
  return (
    <nav aria-label="Knowledge" className="flex overflow-x-auto px-2">
      {KNOWLEDGE_TABS.map((t) => {
        const on = t.key === current;
        return (
          <A
            key={t.key}
            to={t.path}
            params={{ ws }}
            search={search}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'relative whitespace-nowrap px-3 py-2 text-meta transition-colors',
              on ? 'font-semibold text-text-1' : 'font-normal text-text-3 hover:text-text-2',
            )}
          >
            {t.label}
            {on ? <span className="absolute inset-x-2 -bottom-px h-0.5 bg-text-1" aria-hidden /> : null}
          </A>
        );
      })}
    </nav>
  );
}

function ProjectPicker({ tab }: { tab: KnowledgeTab }): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const url = useSearchParams();
  const projects = useProjects();
  const project = url['project'] ?? '';
  const pick = (id: string): void => {
    go(knowledgeTabPath(tab), { params: { ws }, search: id ? { project: id } : {}, replace: true });
  };
  return (
    <label className="flex items-center gap-2">
      <span className="text-micro text-text-3">project</span>
      <select
        value={project}
        onChange={(e) => pick(e.target.value)}
        aria-label="Project"
        className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1"
      >
        <option value="">all</option>
        {(projects.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The frame every Knowledge tab body renders inside. */
export function KnowledgeScreen({ tab, children }: { tab: KnowledgeTab; children: ReactNode }): React.ReactElement {
  // The explorer fills the frame and scrolls its own region (the folder tree and the document pane),
  // so the page body must not scroll too: exactly one scroll container. The other tabs — including
  // the graph, whose fixed-height canvas sits in the page flow and needs the body to scroll — use
  // the page body as their one scroller.
  const fills = tab === 'explorer';
  return (
    <V2Page title="Knowledge" actions={<ProjectPicker tab={tab} />} subnav={<KnowledgeTabs current={tab} />} scroll={!fills}>
      {children}
    </V2Page>
  );
}
