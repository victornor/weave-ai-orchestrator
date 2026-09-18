import { describe, expect, it } from 'vitest';
import type { AgentToolDefinition } from '@weave-ai/plugin-sdk';
import { contractHash, toolContractHash, toolContractProvider } from '../src/tool-contract.js';
import type { WorkspaceRuntime } from '../src/types.js';

const def = (name: string, inputSchema: Record<string, unknown> = { type: 'object', properties: {} }, description = '') => ({ name, description, inputSchema });

function fakeWs(tools: AgentToolDefinition[] = []): WorkspaceRuntime {
  return { ctx: { plugins: { tools } } } as unknown as WorkspaceRuntime;
}

const pluginTool = (name: string, inputSchema: Record<string, unknown> = { type: 'object', properties: {} }): AgentToolDefinition => ({
  name, description: 'a plugin tool', inputSchema, scope: 'all', handler: async () => ({ ok: true }),
});

describe('tool contract fingerprint (VS-542)', () => {
  it('is order-insensitive', () => {
    expect(contractHash([def('weave_a'), def('weave_b')])).toBe(contractHash([def('weave_b'), def('weave_a')]));
  });

  it('changes when a parameter is added', () => {
    const before = contractHash([def('weave_decision_answer', { type: 'object', properties: { id: {}, key: {} } })]);
    const after = contractHash([def('weave_decision_answer', { type: 'object', properties: { id: {}, key: {}, inputs: {} } })]);
    expect(after).not.toBe(before);
  });

  it('changes when only a description moves', () => {
    expect(contractHash([def('weave_a', { type: 'object' }, 'old')])).not.toBe(contractHash([def('weave_a', { type: 'object' }, 'new')]));
  });

  it('includes the workspace plugin tools, so registering one moves it', () => {
    const ws = fakeWs();
    const before = toolContractHash('worker', ws);
    ws.ctx.plugins.tools.push(pluginTool('acme_ping'));
    expect(toolContractHash('worker', ws)).not.toBe(before);
  });

  it('gives each agent kind its own fingerprint', () => {
    const ws = fakeWs();
    expect(toolContractHash('worker', ws)).not.toBe(toolContractHash('weaver', ws));
  });

  it('memoizes the provider per kind and matches the computed hash', () => {
    const ws = fakeWs();
    const provider = toolContractProvider(ws);
    expect(provider('worker')).toBe(provider('worker'));
    expect(provider('worker')).toBe(toolContractHash('worker', ws));
    expect(provider('weaver')).toBe(toolContractHash('weaver', ws));
  });
});
