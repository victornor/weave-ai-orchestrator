import type { WorkspaceContext } from './context.js';
import type { CoreServices } from './api.js';
import { createTicketsService } from './tickets/index.js';
import { createDecisionsService } from './decisions/index.js';
import { createKnowledgeService } from './knowledge/index.js';
import { createSpecsService } from './specs/index.js';
import { createOpenSpecService } from './openspec/index.js';
import { createAccountsService, createUsageService } from './usage/index.js';
import { createThreadsService } from './threads/index.js';
import { createBriefingService } from './briefing/index.js';
import { createWakeService } from './wake/index.js';
import { createRunsService, createDispatcher } from './runs/index.js';
import { createSupervisor } from './supervisor/index.js';
import { createRolesService } from './roles/index.js';
import { createWorkersService } from './workers/index.js';
import { createProjectsService } from './projects/index.js';
import { createJobsService } from './jobs/index.js';
import { createChangelogService } from './changelog/index.js';
import { createModelsService } from './models/index.js';
import { createSecretsService } from './secrets/index.js';

/** Assemble all services for one workspace. Services receive a lazy accessor to the full set to avoid construction-order cycles. */
export function createCore(ctx: WorkspaceContext): CoreServices {
  let services: CoreServices;
  const deps = () => services;
  services = {
    tickets: createTicketsService(ctx, deps), decisions: createDecisionsService(ctx, deps), knowledge: createKnowledgeService(ctx, deps), specs: createSpecsService(ctx, deps),
    openspec: createOpenSpecService(ctx, deps), usage: createUsageService(ctx, deps), accounts: createAccountsService(ctx), threads: createThreadsService(ctx, deps), briefing: createBriefingService(ctx, deps),
    wake: createWakeService(ctx, deps), runs: createRunsService(ctx, deps), dispatcher: createDispatcher(ctx, deps), supervisor: createSupervisor(ctx, deps),
    roles: createRolesService(ctx, deps), workers: createWorkersService(ctx, deps), projects: createProjectsService(ctx, deps),
    models: createModelsService(ctx, deps),
    jobs: createJobsService(ctx, deps), changelog: createChangelogService(ctx, deps),
    secrets: createSecretsService(ctx),
  };
  return services;
}
