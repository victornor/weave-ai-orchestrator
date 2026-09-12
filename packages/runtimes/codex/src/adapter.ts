import { readFileSync, rmSync } from 'node:fs';
import type {
  AccountDescription, AccountProbeInput, AgentHome, InstructionBundle, JsonSchema, RuntimeAdapter,
  RuntimeCapabilities, RuntimeDetection, RuntimeModel, SessionRef, TurnHandle, TurnInput, TurnResult, TurnSink,
} from '@weave-ai/runtime-sdk';
import { classifyError, detectBinary, installBundleFiles, runTmpDir, spawnLines, writeFiles } from '@weave-ai/runtime-sdk';
import { extractReport } from '@weave-ai/shared';
import { describeCodexAccount } from './account.js';
import { buildArgs, mcpConfigToml, resumeCommand } from './args.js';
import { createCodexParser } from './events.js';
import { listModels as listCodexModels } from './models.js';
import { asCodexSession, type CodexSessionRef } from './session.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true,
  forkSessions: true,
  streamingInput: false,
  systemPromptInjection: 'file_only',
  structuredOutput: true,
  mcp: true,
  usageReporting: 'per_turn',
  costReporting: false,
  permissionModes: ['auto', 'restricted', 'bypass'],
};

/** Codex has no `--list-models`; `listModels` tries `codex debug models --bundled` first. */

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', description: 'Model id passed to `codex -m`' },
    effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high'], description: 'model_reasoning_effort' },
    permissionMode: { type: 'string', enum: ['auto', 'restricted', 'bypass'] },
    maxTurns: { type: 'integer', minimum: 1, description: 'Not enforced by codex; used by the supervisor only' },
    maxBudgetUsd: { type: 'number', exclusiveMinimum: 0, description: 'Not enforced by codex; used by the supervisor only' },
    mcpViaConfigFile: { type: 'boolean', default: false, description: 'Write MCP servers into CODEX_HOME/config.toml instead of -c overrides' },
    extraArgs: { type: 'array', items: { type: 'string' } },
  },
};

export const adapter: RuntimeAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',
  capabilities,

  detect(): Promise<RuntimeDetection> { return detectBinary('codex', ['--version']); },
  async listModels(): Promise<RuntimeModel[]> { return listCodexModels(); },
  configSchema(): JsonSchema { return structuredClone(CONFIG_SCHEMA); },
  skillsDir(): string { return '.agents/skills'; },
  instructionFiles(): string[] { return ['AGENTS.md']; },
  resumeCommand,

  async installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void> {
    installBundleFiles(home, bundle, { instructions: { 'AGENTS.md': bundle.instructions }, skillsDir: '.agents/skills' });
  },

  async forkSession(base: SessionRef): Promise<SessionRef> {
    const ref = asCodexSession(base);
    if (!ref) throw new Error('codex: cannot fork a thread without a threadId');
    // `codex exec fork <id>` needs a prompt, so the fork happens on the next turn;
    // the new thread id arrives in that turn's `thread.started`.
    return { threadId: ref.threadId, fork: true } satisfies CodexSessionRef;
  },

  async describeSession(ref: SessionRef) {
    const s = asCodexSession(ref);
    return { displayId: s?.threadId ?? 'unknown', exists: Boolean(s) };
  },

  /** Billing mode only: Codex exposes no plan limits to a non-interactive run. */
  async describeAccount(input: AccountProbeInput): Promise<AccountDescription> { return describeCodexAccount(input); },

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const tmpDir = runTmpDir(input.runId);
    const built = buildArgs(input, { tmpDir });
    writeFiles(built.files);

    const parser = createCodexParser({ resumed: built.mode !== 'new' });
    let seq = 0;
    const run = spawnLines({
      cmd: built.cmd,
      args: built.args,
      cwd: input.cwd,
      env: { ...(process.env as Record<string, string>), ...built.env },
      stdin: built.stdin,
      timeoutMs: input.limits.timeoutMs,
      onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
      onLine: (stream, line) => {
        sink.onRaw(stream, line);
        if (stream === 'stdout') for (const ev of parser.handle(line)) sink.onEvent({ ...ev, seq: seq++ });
      },
    });
    onHandle?.({ pid: run.child.pid ?? null, cancel: (mode) => run.cancel(mode) });

    const outcome = await run.done;
    const st = parser.state;
    let finalText = st.finalText;
    try { finalText = readFileSync(built.lastMessagePath, 'utf8').trim() || finalText; } catch { /* codex may not have written it */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }

    let structured: unknown;
    if (input.outputSchema && finalText) { try { structured = JSON.parse(finalText); } catch { structured = undefined; } }
    if (structured === undefined) structured = extractReport(finalText) ?? undefined;

    const failed = outcome.exitCode !== 0 || outcome.timedOut || st.isError;
    const error = failed
      ? classifyError(outcome.exitCode ?? 1, `${st.errorMessage ?? ''}\n${outcome.stderr}`) ?? {
        code: 'runtime_error', family: 'unknown' as const, message: st.errorMessage ?? 'codex turn failed',
      }
      : undefined;

    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      session: st.threadId ? { threadId: st.threadId } : (built.threadId && built.mode === 'resume' ? { threadId: built.threadId } : null),
      finalText,
      ...(structured !== undefined ? { structured } : {}),
      ...(st.usage ? { usage: { ...st.usage, basis: 'per_turn' as const } } : {}),
      ...(input.model ? { model: input.model } : {}),
      provider: 'openai',
      ...(error ? { error } : {}),
    };
  },
};

export { mcpConfigToml };
export default adapter;
