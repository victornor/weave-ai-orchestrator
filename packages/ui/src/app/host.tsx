/**
 * The routes a shared V1 component navigates to, supplied by whichever host renders it (VS-434).
 *
 * V1's `routes/*` components are reused inside the V2 frame (`KnowledgeExplorer`,
 * `KnowledgeDocPanel`, the settings sections). A hard-coded `/w/…` path inside one of them throws the
 * reader back to V1, because V2's addresses live under `/v2/w/…`. Rather than special-case V2 in each
 * component, the host provides the routes: `V2Root` wraps the `/v2` tree in `V2_HOST_ROUTES`, and
 * everywhere else the default is V1's, so V1 is unchanged.
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
  knowledgeExplorer: '/v2/w/$ws/knowledge/explorer',
  knowledgeExplorerSearch: {},
  artifact: '/v2/w/$ws/artifacts/$key',
  ticket: '/v2/w/$ws/tickets/$ticketId',
};

const HostRoutesCtx = createContext<HostRoutes>(V1_HOST_ROUTES);

export function HostRoutesProvider({ routes, children }: { routes: HostRoutes; children: ReactNode }): React.ReactElement {
  return <HostRoutesCtx.Provider value={routes}>{children}</HostRoutesCtx.Provider>;
}

export function useHostRoutes(): HostRoutes {
  return useContext(HostRoutesCtx);
}
