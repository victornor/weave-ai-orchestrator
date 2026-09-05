/**
 * The deferred daemon upgrade, as the web app reads it (PLAN §20). The lifecycle and its two
 * predicates mirror `UPGRADE_STATES` in `@agent-conductor/shared`; they are restated here because the
 * web app must not import the daemon's enums module into the browser bundle.
 */
import type { UpgradeState, Upgrade, UpdateStatus } from '../api/types';

export const TERMINAL_UPGRADE_STATES: readonly UpgradeState[] = ['completed', 'failed', 'cancelled'];
export const CANCELLABLE_UPGRADE_STATES: readonly UpgradeState[] = ['queued', 'waiting'];

export const isTerminalUpgrade = (state: UpgradeState | undefined | null): boolean =>
  Boolean(state && TERMINAL_UPGRADE_STATES.includes(state));

export const isCancellableUpgrade = (state: UpgradeState | undefined | null): boolean =>
  Boolean(state && CANCELLABLE_UPGRADE_STATES.includes(state));

/** True while the daemon is expected to be unreachable. */
export const isRestarting = (state: UpgradeState | undefined | null): boolean => state === 'restarting';

export const UPGRADE_STAGE_LABEL: Record<UpgradeState, string> = {
  queued: 'Queued',
  waiting: 'Waiting for running work',
  building: 'Building the new release',
  switching: 'Backing up and switching',
  restarting: 'Restarting the daemon',
  completed: 'Up to date',
  failed: 'Upgrade failed',
  cancelled: 'Cancelled',
};

/** An upgrade is in flight when it exists and has not reached a terminal state. */
export const inFlight = (upgrade: Upgrade | null | undefined): boolean =>
  Boolean(upgrade && !isTerminalUpgrade(upgrade.state));

/** The indicator shows only for a real, checkable, available update. */
export const showsUpdateIndicator = (status: UpdateStatus | undefined): boolean =>
  Boolean(status?.configured && status.updateAvailable && !status.error);

/**
 * How often to re-read the upgrade record. Polling stops at a terminal state; while the daemon is
 * restarting the request fails, and that failure is also how the client notices it is back.
 */
export const UPGRADE_POLL_MS = 2000;

export const upgradePollInterval = (state: UpgradeState | undefined | null): number | false =>
  (!state || isTerminalUpgrade(state) ? false : UPGRADE_POLL_MS);

export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 10) : '—');
