import type { WorkspaceContext } from '../context.js'; import type { CoreServices, DecisionsService } from '../api.js'; import { stub } from '../stub.js';
export function createDecisionsService(_ctx: WorkspaceContext, _deps: () => CoreServices): DecisionsService { return stub<DecisionsService>('decisions'); }
