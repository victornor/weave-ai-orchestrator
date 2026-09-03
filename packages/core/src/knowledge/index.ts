import type { WorkspaceContext } from '../context.js'; import type { CoreServices, KnowledgeService } from '../api.js'; import { stub } from '../stub.js';
export function createKnowledgeService(_ctx: WorkspaceContext, _deps: () => CoreServices): KnowledgeService { return stub<KnowledgeService>('knowledge'); }
