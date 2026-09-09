import type {
  AccountDescription, AccountProbeInput, AgentHome, CredentialFacts, CredentialProbeInput,
  InputDelivery, InstructionBundle, JsonSchema, RuntimeAdapter, RuntimeCapabilities,
  RuntimeDetection, RuntimeModel, SessionRef, TurnHandle, TurnInput, TurnResult, TurnSink,
} from '@agent-conductor/runtime-sdk';
import { classifyError, detectBinary, installBundleFiles, launchCommand, spawnLines, writeFiles } from '@agent-conductor/runtime-sdk';
import { extractReport } from '@agent-conductor/shared';
import { describeCursorAccount } from './account.js';
import { buildArgs, userFrame } from './args.js';
import { readCredential } from './credential.js';
import { createCursorParser } from './events.js';
import { asCursorSession } from './session.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true,
  forkSessions: false,
  streamingInput: true,
  systemPromptInjection: 'file_only',
  structuredOutput: false,
  mcp: true,
  usageReporting: 'none',
  costReporting: false,
  permissionModes: ['auto', 'restricted', 'bypass'],
};

const MODELS: RuntimeModel[] = [
  { id: 'auto', label: 'Auto', provider: 'cursor', source: 'static', tier: 'balanced' },
  { id: 'gpt-5', label: 'GPT-5', provider: 'openai', source: 'static', tier: 'frontier' },
  { id: 'sonnet-4-thinking', label: 'Sonnet 4 Thinking', provider: 'anthropic', source: 'static', tier: 'frontier' },
  { id: 'composer-2-5', label: 'Composer 2.5', provider: 'cursor', source: 'static', tier: 'balanced' },
];

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', description: 'Model id passed to `cursor-agent --model`' },
    permissionMode: { type: 'string', enum: ['auto', 'restricted', 'bypass'] },
    extraArgs: { type: 'array', items: { type: 'string' } },
  },
};

export const adapter: RuntimeAdapter = {
  id: 'cursor',
  displayName: 'Cursor CLI',
  capabilities,

  detect(): Promise<RuntimeDetection> { return detectBinary('cursor-agent', ['--version']); },
  async listModels(): Promise<RuntimeModel[]> { return MODELS.map((m) => ({ ...m })); },
  configSchema(): JsonSchema { return structuredClone(CONFIG_SCHEMA); },
  skillsDir(): string { return '.cursor/skills'; },
  instructionFiles(): string[] { return ['AGENTS.md']; },

  async installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void> {
    installBundleFiles(home, bundle, {
      instructions: { 'AGENTS.md': bundle.instructions, 'CLAUDE.md': '@AGENTS.md\n' },
      skillsDir: '.cursor/skills',
    });
  },

  async describeSession(ref: SessionRef) {
    const s = asCursorSession(ref);
    return { displayId: s?.sessionId ?? 'unknown', exists: Boolean(s) };
  },

  async describeAccount(input: AccountProbeInput): Promise<AccountDescription> { return describeCursorAccount(input); },
  readCredential(input: CredentialProbeInput): CredentialFacts { return readCredential(input); },

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const built = buildArgs(input);
    writeFiles(built.files);

    const parser = createCursorParser({ resumed: built.resumed });
    let seq = 0;
    const launch = launchCommand(built.cmd, built.env);
    const run = spawnLines({
      cmd: launch.cmd,
      args: built.args,
      cwd: input.cwd,
      env: launch.env,
      stdin: built.stdin,
      stdinMode: built.liveInput ? 'open' : 'close',
      timeoutMs: input.limits.timeoutMs,
      onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
      onLine: (stream, line) => {
        sink.onRaw(stream, line);
        if (stream === 'stdout') {
          for (const ev of parser.handle(line)) sink.onEvent({ ...ev, seq: seq++ });
          if (built.liveInput && parser.state.resultSeen) run.endStdin();
        }
      },
    });
    onHandle?.({
      pid: run.child.pid ?? null,
      cancel: (mode) => run.cancel(mode),
      ...(built.liveInput
        ? {
          send: async (text: string): Promise<InputDelivery> => {
            if (parser.state.resultSeen) return 'closed';
            return run.write(userFrame(text)) ? 'delivered' : 'closed';
          },
        }
        : {}),
    });

    const outcome = await run.done;
    parser.finish();

    const st = parser.state;
    const structured = extractReport(st.finalText) ?? undefined;
    const failed = outcome.exitCode !== 0 || outcome.timedOut || st.isError;
    const error = failed
      ? classifyError(outcome.exitCode ?? 1, `${st.errorMessage ?? ''}\n${outcome.stderr}`) ?? {
        code: 'runtime_error', family: 'unknown' as const, message: st.errorMessage ?? 'cursor turn failed',
      }
      : undefined;

    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      session: st.sessionId ? { sessionId: st.sessionId } : (built.sessionId ? { sessionId: built.sessionId } : null),
      finalText: st.finalText,
      ...(structured !== undefined ? { structured } : {}),
      ...(st.model ?? input.model ? { model: st.model ?? input.model ?? undefined } : {}),
      provider: 'cursor',
      ...(error ? { error } : {}),
    };
  },
};

export default adapter;
