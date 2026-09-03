import type { WorkspaceContext } from '../context.js'; import type { CoreServices, OpenSpecService } from '../api.js'; import { stub } from '../stub.js';
export function createOpenSpecService(_ctx: WorkspaceContext, _deps: () => CoreServices): OpenSpecService { return stub<OpenSpecService>('openspec'); }
