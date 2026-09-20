/**
 * The V2 root and its shell layout. `V2Root` owns the scoped `.v2-root` element that carries the
 * Mono tokens and the active theme; the shell (rail, phone tab bar) is a separate pathless layout
 * inside it, so `/login` renders the tokens and theme with no chrome (VS-353).
 */
import { createContext, useContext } from 'react';
import { Outlet, useParams } from '@tanstack/react-router';
import { WorkspaceProvider } from '../api/context';
import { HostRoutesProvider, V2_HOST_ROUTES } from '../app/host';
import { useV2Theme, type V2ThemeState } from './theme';
import { useTextSize } from './textSize';
import { V2Shell } from './V2Shell';
import { DictationSessionProvider } from './DictationSession';
import { TicketModalProvider } from './ticket/TicketModal';

const V2ThemeContext = createContext<V2ThemeState | null>(null);

/** The V2 theme, provided by `V2Root` so the token root and the shell switch share one choice. */
export function useV2ThemeState(): V2ThemeState {
  const ctx = useContext(V2ThemeContext);
  if (!ctx) throw new Error('useV2ThemeState must be used inside V2Root');
  return ctx;
}

export function V2Root(): React.ReactElement {
  const theme = useV2Theme();
  const { size } = useTextSize();
  return (
    <HostRoutesProvider routes={V2_HOST_ROUTES}>
      <V2ThemeContext.Provider value={theme}>
        <div
          className="v2-root flex h-[100dvh] min-h-0 flex-col overflow-hidden"
          data-theme={theme.theme}
          data-text-size={size}
        >
          <Outlet />
        </div>
      </V2ThemeContext.Provider>
    </HostRoutesProvider>
  );
}

/** The chrome for every signed-in V2 page. `/login` is a sibling, so it renders without it. */
export function V2ShellLayout(): React.ReactElement {
  const { theme, setTheme } = useV2ThemeState();
  // The dictation session sits above the shell so it survives navigating between pages (VS-450).
  return (
    <DictationSessionProvider>
      <V2Shell theme={theme} onTheme={setTheme} />
    </DictationSessionProvider>
  );
}

export function V2Workspace(): React.ReactElement {
  const params = useParams({ strict: false }) as { ws?: string };
  const ws = params.ws ?? '';
  return (
    <WorkspaceProvider ws={ws}>
      <TicketModalProvider>
        <Outlet />
      </TicketModalProvider>
    </WorkspaceProvider>
  );
}
