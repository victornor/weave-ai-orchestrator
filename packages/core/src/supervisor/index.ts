import type { WorkspaceContext } from '../context.js'; import type { CoreServices, Supervisor } from '../api.js'; import { stub } from '../stub.js';
export function createSupervisor(_ctx: WorkspaceContext, _deps: () => CoreServices): Supervisor { return stub<Supervisor>('supervisor'); }
