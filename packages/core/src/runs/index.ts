import type { WorkspaceContext } from '../context.js'; import type { CoreServices, RunsService, Dispatcher } from '../api.js'; import { stub } from '../stub.js';
export function createRunsService(_ctx: WorkspaceContext, _deps: () => CoreServices): RunsService { return stub<RunsService>('runs'); }
export function createDispatcher(_ctx: WorkspaceContext, _deps: () => CoreServices): Dispatcher { return stub<Dispatcher>('dispatcher'); }
