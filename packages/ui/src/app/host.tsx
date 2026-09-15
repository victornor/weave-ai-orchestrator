/**
 * The routes a shared component navigates to, supplied by whichever host renders it (VS-434).
 *
 * V1's `routes/*` components are reused inside the V2 frame (`KnowledgeExplorer`,
 * `KnowledgeDocPanel`, the settings sections). The host provides the routes rather than each
 * component hard-coding them: `V2Root` wraps the tree in `V2_HOST_ROUTES`. The V1 host is retired
 * with the promotion (VS-456); its routes stay as the context default until the V1 code is deleted.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface HostRoutes {
  /** The route the Knowledge Explorer writes its selection to (V1's tabbed page, V2's own path). */
  knowledgeExplorer: string;
  /** Search the knowledge route needs to show the explorer (V1's `tab=explorer`; empty in V2). */
  knowledgeExplorerSearch: Record<string, unknown>;
  /** The workspace-scoped artifact reader. */
  artifact: string;
  /** A ticket's page. */
  ticket: string;
}

export const V1_HOST_ROUTES: HostRoutes = {
  knowledgeExplorer: '/w/$ws/knowledge',
  knowledgeExplorerSearch: { tab: 'explorer' },
  artifact: '/w/$ws/artifacts/$key',
  ticket: '/w/$ws/tickets/$ticketId',
};

export const V2_HOST_ROUTES: HostRoutes = {
  knowledgeExplorer: '/w/$ws/knowledge/explorer',
  knowledgeExplorerSearch: {},
  artifact: '/w/$ws/artifacts/$key',
  ticket: '/w/$ws/tickets/$ticketId',
};

const HostRoutesCtx = createContext<HostRoutes>(V1_HOST_ROUTES);

export function HostRoutesProvider({ routes, children }: { routes: HostRoutes; children: ReactNode }): React.ReactElement {
  return <HostRoutesCtx.Provider value={routes}>{children}</HostRoutesCtx.Provider>;
}

export function useHostRoutes(): HostRoutes {
  return useContext(HostRoutesCtx);
}
