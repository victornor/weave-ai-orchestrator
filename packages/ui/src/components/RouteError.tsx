import { useEffect, useState } from 'react';
import { ErrorState } from './States';
import { Button } from './Button';
import { isDynamicImportError, markChunkReload, shouldReloadForChunkError } from '../lib/chunkReload';

/**
 * The router's `defaultErrorComponent` (VS-210). A route that fails to load because a
 * dynamically-imported chunk could not be fetched is not the same fact as a real bug: it means this
 * tab has been open since before an upgrade and is holding stale chunk names. That case reloads
 * once, since a fresh `index.html` references the current build; a real error keeps showing the
 * app's existing generic error state, unchanged.
 */
export function RouteError({ error, reset }: { error: Error; reset: () => void }): React.ReactElement {
  const chunkError = isDynamicImportError(error);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!chunkError) return;
    if (shouldReloadForChunkError()) {
      markChunkReload();
      window.location.reload();
    } else {
      setGaveUp(true);
    }
  }, [error, chunkError]);

  if (chunkError && !gaveUp) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-bg-0 p-6 text-center">
        <p className="text-meta text-text-2">Updating…</p>
      </div>
    );
  }

  if (gaveUp) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg-0 p-6 text-center">
        <h1 className="text-title font-semibold tracking-title text-text-strong">The app was updated.</h1>
        <p className="max-w-sm text-meta leading-relaxed text-text-2">
          Reloading didn&rsquo;t finish it. Reload the page to pick up the new version.
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
