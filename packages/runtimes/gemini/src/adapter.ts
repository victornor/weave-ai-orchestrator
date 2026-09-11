import { randomUUID } from 'node:crypto';
import type {
  AccountDescription, AccountProbeInput, AgentHome, InstructionBundle, JsonSchema, RuntimeAdapter,
  RuntimeCapabilities, RuntimeDetection, RuntimeModel, SessionRef, TurnHandle, TurnInput, TurnResult, TurnSink,
} from '@agent-conductor/runtime-sdk';
import { classifyError, detectBinary, installBundleFiles, spawnLines, writeFiles } from '@agent-conductor/runtime-sdk';
import { extractReport } from '@agent-conductor/shared';
import { describeGeminiAccount } from './account.js';
import { buildArgs, geminiSettings, resumeCommand, SETTINGS_RELATIVE_PATH } from './args.js';
import { createGeminiParser } from './events.js';
import { asGeminiSession } from './session.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true,
  forkSessions: false,
  streamingInput: false,
  systemPromptInjection: 'file_only',
  structuredOutput: false,
  mcp: true,
  usageReporting: 'per_turn',
  costReporting: false,
  permissionModes: ['auto', 'restricted', 'bypass'],
};

const MODELS: RuntimeModel[] = [
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro', provider: 'google', source: 'static', tier: 'frontier', efforts: [] },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', provider: 'google', source: 'static', tier: 'balanced', efforts: [] },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', source: 'static', tier: 'frontier', efforts: [] },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', source: 'static', tier: 'balanced', efforts: [] },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'google', source: 'static', tier: 'fast', efforts: [] },
];

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', enum: MODELS.map((m) => m.id) },
    effort: { type: 'string', description: 'Not supported by gemini 0.58; recorded for reporting only' },
    permissionMode: { type: 'string', enum: ['auto', 'restricted', 'bypass'] },
    maxTurns: { type: 'integer', minimum: 1, description: 'Set via maxSessionTurns in settings.json, not a flag' },
    maxBudgetUsd: { type: 'number', exclusiveMinimum: 0, description: 'Not enforced by gemini; used by the supervisor only' },
    extraArgs: { type: 'array', items: { type: 'string' } },
  },
};

export const adapter: RuntimeAdapter = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  capabilities,

  detect(): Promise<RuntimeDetection> { return detectBinary('gemini', ['--version']); },
  async listModels(): Promise<RuntimeModel[]> { return MODELS.map((m) => ({ ...m })); },
  configSchema(): JsonSchema { return structuredClone(CONFIG_SCHEMA); },
  skillsDir(): string { return '.gemini/skills'; },
  instructionFiles(): string[] { return ['GEMINI.md']; },
  resumeCommand,

  async installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void> {
    installBundleFiles(home, bundle, {
      instructions: { 'GEMINI.md': bundle.instructions },
      skillsDir: '.gemini/skills',
      // Placeholder; runTurn rewrites it with the per-run MCP endpoint before each turn.
      extraFiles: { [SETTINGS_RELATIVE_PATH]: geminiSettings({}) },
    });
  },

  async describeSession(ref: SessionRef) {
    const s = asGeminiSession(ref);
    return { displayId: s?.sessionId ?? 'unknown', exists: Boolean(s) };
  },

  /** Billing mode only: Gemini CLI keeps its quota in memory. */
  async describeAccount(input: AccountProbeInput): Promise<AccountDescription> { return describeGeminiAccount(input); },

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const built = buildArgs(input, { newSessionId: randomUUID() });
    writeFiles(built.files);

    const parser = createGeminiParser({ resumed: built.resumed });
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
    parser.finish();

    const st = parser.state;
    // No native structured output: the report is a fenced json block in the final text (§9.4).
    const structured = extractReport(st.finalText) ?? undefined;
    const failed = outcome.exitCode !== 0 || outcome.timedOut || st.isError;
    const error = failed
      ? classifyError(outcome.exitCode ?? 1, `${st.errorMessage ?? ''}\n${outcome.stderr}`) ?? {
        code: 'runtime_error', family: 'unknown' as const, message: st.errorMessage ?? 'gemini turn failed',
      }
      : undefined;

    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      session: { sessionId: st.sessionId ?? built.sessionId },
      finalText: st.finalText,
      ...(structured !== undefined ? { structured } : {}),
      ...(st.usage ? { usage: { ...st.usage, basis: 'per_turn' as const } } : {}),
      ...(st.model ?? input.model ? { model: st.model ?? input.model ?? undefined } : {}),
      provider: 'google',
      ...(error ? { error } : {}),
    };
  },
};

export default adapter;
