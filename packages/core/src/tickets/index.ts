import type { WorkspaceContext } from '../context.js'; import type { CoreServices, TicketsService } from '../api.js'; import { stub } from '../stub.js';
export function createTicketsService(_ctx: WorkspaceContext, _deps: () => CoreServices): TicketsService { return stub<TicketsService>('tickets'); }
