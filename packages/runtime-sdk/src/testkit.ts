import type { RuntimeAdapter, TurnInput, TurnSink, TurnResult, RuntimeModel } from './index.js';

/** A scripted fake runtime for engine tests: returns queued results, records inputs. */
export class FakeRuntime implements RuntimeAdapter {
  readonly id = 'fake'; readonly displayName = 'Fake';
  readonly capabilities = { resumableSessions: true, forkSessions: false, streamingInput: false, systemPromptInjection: 'system_prompt' as const, structuredOutput: true, mcp: true, usageReporting: 'per_turn' as const, costReporting: false, permissionModes: ['auto'] };
  inputs: TurnInput[] = [];
  queue: Array<Partial<TurnResult> | ((input: TurnInput) => Partial<TurnResult> | Promise<Partial<TurnResult>>)> = [];
  delayMs = 0;
  async detect() { return { status: 'available' as const, version: 'fake' }; }
  async listModels(): Promise<RuntimeModel[]> { return [{ id: 'fake-1', label: 'Fake 1', provider: 'fake', source: 'static' }]; }
  configSchema() { return { type: 'object', properties: {} }; }
  async installInstructions() { /* noop */ }
  skillsDir() { return '.fake/skills'; }
  instructionFiles() { return ['AGENTS.md']; }
  async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnResult> {
    this.inputs.push(input);
    sink.onSpawn({ pid: process.pid, pgid: null });
    sink.onEvent({ ts: new Date().toISOString(), type: 'session.started', payload: {} });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const next = this.queue.shift();
    const partial = typeof next === 'function' ? await next(input) : (next ?? {});
    const structured = partial.structured ?? { state: 'idle', summary: 'fake idle', tickets: [] };
    sink.onEvent({ ts: new Date().toISOString(), type: 'turn.completed', payload: {} });
    return { exitCode: 0, signal: null, timedOut: false, session: partial.session ?? input.session.ref ?? { sessionId: `fake-${input.runId}` }, finalText: partial.finalText ?? JSON.stringify(structured), structured, usage: partial.usage ?? { inputTokens: 100, outputTokens: 50, basis: 'per_turn' }, model: 'fake-1', provider: 'fake', ...partial };
  }
}
