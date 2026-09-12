import type { JsonSchema, SurfaceAdapter, SurfaceHandle } from '@weave-ai/surface-sdk';

export interface HeadlessHandle extends SurfaceHandle { kind: 'headless'; agentId: string }

/** The default surface: nothing is shown; monitoring happens in the web UI or ad-hoc `weave attach`. */
export function createHeadlessSurface(): SurfaceAdapter {
  return {
    kind: 'headless',
    async detect() { return { available: true, notes: 'always available' }; },
    configSchema(): JsonSchema {
      return { type: 'object', additionalProperties: false, properties: { surface: { type: 'string' } } };
    },
    async ensureAgentView(agent) {
      return { kind: 'headless', agentId: agent.agentId } satisfies HeadlessHandle;
    },
    async ensureConductorView() {
      return { kind: 'headless', agentId: 'weaver' } satisfies HeadlessHandle;
    },
    async updateAgentView() { /* no-op */ },
    async focusAgentView() { /* no-op */ },
    async closeAgentView() { /* no-op */ },
    async layout() { /* no-op */ },
    async verify() { return true; },
  };
}

export const adapter: SurfaceAdapter = createHeadlessSurface();
export default adapter;
