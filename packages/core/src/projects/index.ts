import type { WorkspaceContext } from '../context.js'; import type { CoreServices, ProjectsService } from '../api.js'; import { stub } from '../stub.js';
export function createProjectsService(_ctx: WorkspaceContext, _deps: () => CoreServices): ProjectsService { return stub<ProjectsService>('projects'); }
