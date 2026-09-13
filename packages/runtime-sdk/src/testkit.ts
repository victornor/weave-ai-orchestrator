import type { InputDelivery, ResumeCommand, ResumeCommandInput, RuntimeAdapter, TurnHandle, TurnInput, TurnSink, TurnResult, RuntimeModel } from './index.js';

/** A scripted fake runtime for engine tests: returns queued results, records inputs. */
export class FakeRuntime implements RuntimeAdapter {
  readonly id = 'fake'; readonly displayName = 'Fake';
  /** Flip to `true` before a turn to have `runTurn` hand back a `TurnHandle` with `send`. */
  streamingInput = false;
  /** VS-249: flip to `false` to simulate a runtime that cannot resume a session at all. */
  resumableSessions = true;
  /** VS-317: set to simulate an adapter that declares scheduling tools to deny on worker turns. */
  workerDeniedTools?: string[];
  get capabilities() {
    return { resumableSessions: this.resumableSessions, forkSessions: false, streamingInput: this.streamingInput, systemPromptInjection: 'system_prompt' as const, structuredOutput: true, mcp: true, usageReporting: 'per_turn' as const, costReporting: false, permissionModes: ['auto'] };
  }
  inputs: TurnInput[] = [];
  queue: Array<Partial<TurnResult> | ((input: TurnInput) => Partial<TurnResult> | Promise<Partial<TurnResult>>)> = [];
  delayMs = 0;
  /** Every `send()` call this turn, in order. */
  sentInputs: string[] = [];
  /** What `send()` reports next — scriptable per test, e.g. set to `'closed'` to exercise the queued fallback. */
  sendResult: InputDelivery | ((text: string) => InputDelivery) = 'delivered';
  private handleWaiters: Array<(h: TurnHandle | undefined) => void> = [];
  /** Resolves the next time `runTurn` invokes (or skips) `onHandle`. Register before `executeRun`. */
  nextHandle(): Promise<TurnHandle | undefined> {
    return new Promise((resolve) => { this.handleWaiters.push(resolve); });
  }
  async detect() { return { status: 'available' as const, version: 'fake' }; }
  async listModels(): Promise<RuntimeModel[]> { return [{ id: 'fake-1', label: 'Fake 1', provider: 'fake', source: 'static' }]; }
  configSchema() { return { type: 'object', properties: {} }; }
  async installInstructions() { /* noop */ }
  skillsDir() { return '.fake/skills'; }
  instructionFiles() { return ['AGENTS.md']; }
  resumeCommand(input: ResumeCommandInput): ResumeCommand {
    const sessionId = typeof (input.session as { sessionId?: unknown }).sessionId === 'string' ? (input.session as { sessionId: string }).sessionId : 'unknown';
    return { cmd: 'fake', args: ['--resume', sessionId], env: input.configHome ? { FAKE_CONFIG_DIR: input.configHome } : {} };
  }
  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    this.inputs.push(input);
    sink.onSpawn({ pid: process.pid, pgid: null });
    let handle: TurnHandle | undefined;
    if (this.streamingInput) {
      handle = {
        pid: process.pid,
        cancel: async () => { /* not exercised by fake turns */ },
        send: async (text: string): Promise<InputDelivery> => {
          this.sentInputs.push(text);
          return typeof this.sendResult === 'function' ? this.sendResult(text) : this.sendResult;
        },
      };
      onHandle?.(handle);
    }
    for (const w of this.handleWaiters.splice(0)) w(handle);
    sink.onEvent({ ts: new Date().toISOString(), type: 'session.started', payload: {} });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const next = this.queue.shift();
    const partial = typeof next === 'function' ? await next(input) : (next ?? {});
    const structured = partial.structured ?? { state: 'idle', summary: 'fake idle', tickets: [] };
    sink.onEvent({ ts: new Date().toISOString(), type: 'turn.completed', payload: {} });
    return { exitCode: 0, signal: null, timedOut: false, session: partial.session ?? input.session.ref ?? { sessionId: `fake-${input.runId}` }, finalText: partial.finalText ?? JSON.stringify(structured), structured, usage: partial.usage ?? { inputTokens: 100, outputTokens: 50, basis: 'per_turn' }, model: 'fake-1', provider: 'fake', ...partial };
  }
}
