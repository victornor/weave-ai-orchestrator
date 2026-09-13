/**
 * The V2 root: the scoped `.v2-root` element that carries the Mono tokens and the active theme,
 * and the workspace layout that gives a `/v2/w/<ws>` subtree the same `WorkspaceProvider` V1 uses.
 */
import { Outlet, useParams } from '@tanstack/react-router';
import { WorkspaceProvider } from '../api/context';
import { useV2Theme } from './theme';
import { V2Shell } from './V2Shell';
import './v2.css';

export function V2Root(): React.ReactElement {
  const { theme, setTheme } = useV2Theme();
  return (
    <div className="v2-root flex h-[100dvh] min-h-0 flex-col overflow-hidden" data-theme={theme}>
      <V2Shell theme={theme} onTheme={setTheme} />
    </div>
  );
}

export function V2Workspace(): React.ReactElement {
  const params = useParams({ strict: false }) as { ws?: string };
  const ws = params.ws ?? '';
  return (
    <WorkspaceProvider ws={ws}>
      <Outlet />
    </WorkspaceProvider>
  );
}
