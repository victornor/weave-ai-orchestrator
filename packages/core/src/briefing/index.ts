import type { WorkspaceContext } from '../context.js'; import type { CoreServices, BriefingService } from '../api.js'; import { stub } from '../stub.js';
export function createBriefingService(_ctx: WorkspaceContext, _deps: () => CoreServices): BriefingService { return stub<BriefingService>('briefing'); }
