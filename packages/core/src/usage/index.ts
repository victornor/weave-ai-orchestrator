import type { WorkspaceContext } from '../context.js'; import type { CoreServices, UsageService } from '../api.js'; import { stub } from '../stub.js';
export function createUsageService(_ctx: WorkspaceContext, _deps: () => CoreServices): UsageService { return stub<UsageService>('usage'); }
