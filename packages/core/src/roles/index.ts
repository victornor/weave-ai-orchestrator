import type { WorkspaceContext } from '../context.js'; import type { CoreServices, RolesService } from '../api.js'; import { stub } from '../stub.js';
export function createRolesService(_ctx: WorkspaceContext, _deps: () => CoreServices): RolesService { return stub<RolesService>('roles'); }
