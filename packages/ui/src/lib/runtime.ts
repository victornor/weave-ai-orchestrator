import type { RuntimeInfo } from '../api/types';

/**
 * `GET /api/runtimes` returns `adapter.detect()` verbatim (packages/server/src/routes/daemon.ts),
 * so a runtime is launchable only when its detection status is exactly `available`.
 */
export function isRuntimeAvailable(r: RuntimeInfo): boolean {
  return r.detection?.status === 'available';
}

/** What to show next to a runtime: its version when it works, why it does not otherwise. */
export function runtimeStatusLabel(r: RuntimeInfo): string {
  switch (r.detection?.status) {
    case 'available':
      return r.detection.version ?? 'available';
    case 'missing_binary':
      return 'not installed';
    case 'broken':
      return 'installed but not working';
    case 'unsupported':
      return 'not supported on this host';
    default:
      return 'unknown';
  }
}
