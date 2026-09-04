import type { WorkspaceContext } from '../context.js'; import type { CoreServices, BriefingService } from '../api.js';
import { createBriefingService as build } from './service.js';
export function createBriefingService(ctx: WorkspaceContext, _deps: () => CoreServices): BriefingService { return build(ctx); }
