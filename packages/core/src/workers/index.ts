import type { WorkspaceContext } from '../context.js'; import type { CoreServices, WorkersService } from '../api.js'; import { stub } from '../stub.js';
export function createWorkersService(_ctx: WorkspaceContext, _deps: () => CoreServices): WorkersService { return stub<WorkersService>('workers'); }
