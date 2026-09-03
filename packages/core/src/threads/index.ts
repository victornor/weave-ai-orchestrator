import type { WorkspaceContext } from '../context.js'; import type { CoreServices, ThreadsService } from '../api.js'; import { stub } from '../stub.js';
export function createThreadsService(_ctx: WorkspaceContext, _deps: () => CoreServices): ThreadsService { return stub<ThreadsService>('threads'); }
