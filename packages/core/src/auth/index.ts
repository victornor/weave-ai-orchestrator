import type { Db } from '@openconductor/db'; import type { DaemonConfig } from '@openconductor/shared'; import type { AuthService } from '../api.js'; import { stub } from '../stub.js';
/** Auth is daemon-level (one operator per daemon), backed by the daemon db. */
export function createAuthService(_db: Db, _cfg: DaemonConfig): AuthService { return stub<AuthService>('auth'); }
