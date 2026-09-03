import type { WorkspaceContext } from '../context.js'; import type { CoreServices, WakeService } from '../api.js'; import { stub } from '../stub.js';
export function createWakeService(_ctx: WorkspaceContext, _deps: () => CoreServices): WakeService { return stub<WakeService>('wake'); }
