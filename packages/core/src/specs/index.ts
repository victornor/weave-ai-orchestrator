import type { WorkspaceContext } from '../context.js'; import type { CoreServices, SpecsService } from '../api.js'; import { stub } from '../stub.js';
export function createSpecsService(_ctx: WorkspaceContext, _deps: () => CoreServices): SpecsService { return stub<SpecsService>('specs'); }
