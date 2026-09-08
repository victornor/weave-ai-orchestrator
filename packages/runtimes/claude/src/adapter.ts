import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type {
  AccountDescription, AccountProbeInput, AgentHome, CredentialFacts, CredentialProbeInput, InputDelivery, InstructionBundle,
  JsonSchema, RuntimeAdapter, RuntimeCapabilities, RuntimeDetection, RuntimeModel, SessionRef, TurnHandle,
  TurnInput, TurnResult, TurnSink,
} from '@agent-conductor/runtime-sdk';
import { classifyError, detectBinary, installBundleFiles, launchCommand, runTmpDir, spawnLines, writeFiles } from '@agent-conductor/runtime-sdk';
import { extractReport } from '@agent-conductor/shared';
import { probeAccount } from './account.js';
import { readCredential } from './credential.js';
import { buildArgs, RESTRICTED_TOOLS, userFrame } from './args.js';
import { createClaudeParser } from './events.js';
import { asClaudeSession, type ClaudeSessionRef } from './session.js';

/** See `capabilities.contextCompactionAt`. One place, so nothing downstream hard-codes it. */
export const CONTEXT_COMPACTION_AT = 0.92;

/**
 * Not every Claude Code model shares one window: `fable`/`opus`/`sonnet` and their pinned `-5`/`-5-1`
 * ids resolve to natively 1M-context models today, and only `haiku` is still 200k. Verified against
 * the installed CLI's own hand-maintained model catalog (`context.window` per model id), not guessed
 * — see VS-129's `design.md` for the extraction method and the full per-model evidence table. Check
 * this against the CLI's own catalog again whenever a model in `MODELS` below changes.
 */
const CONTEXT_WINDOW_TOKENS_STANDARD = 200_000;
const CONTEXT_WINDOW_TOKENS_1M = 1_000_000;

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true,
  forkSessions: true,
  streamingInput: true,
  systemPromptInjection: 'append',
  structuredOutput: true,
  mcp: true,
  usageReporting: 'per_turn',
  costReporting: true,
  permissionModes: ['auto', 'restricted', 'bypass'],
  // Claude Code compacts the conversation on its own as the window fills, and does not report the
  // point it does that at over the wire, so this is a constant we maintain rather than something
  // the CLI told us. Check it against the CLI's release notes when auto-compaction changes; it is
  // read only to say how far a context is from being compacted, never to trigger anything.
  contextCompactionAt: CONTEXT_COMPACTION_AT,
};

/** Aliases plus pinned ids. Claude Code has no machine-readable model list, so this is `static`. */
const MODELS: RuntimeModel[] = [
  { id: 'fable', label: 'Fable (latest)', provider: 'anthropic', source: 'static', tier: 'frontier', contextWindowTokens: CONTEXT_WINDOW_TOKENS_1M },
  { id: 'opus', label: 'Opus (latest)', provider: 'anthropic', source: 'static', tier: 'frontier', contextWindowTokens: CONTEXT_WINDOW_TOKENS_1M },
  { id: 'sonnet', label: 'Sonnet (latest)', provider: 'anthropic', source: 'static', tier: 'balanced', contextWindowTokens: CONTEXT_WINDOW_TOKENS_1M },
  { id: 'haiku', label: 'Haiku (latest)', provider: 'anthropic', source: 'static', tier: 'fast', contextWindowTokens: CONTEXT_WINDOW_TOKENS_STANDARD },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', provider: 'anthropic', source: 'static', tier: 'frontier', contextWindowTokens: CONTEXT_WINDOW_TOKENS_1M },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', source: 'static', tier: 'frontier', contextWindowTokens: CONTEXT_WINDOW_TOKENS_1M },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', source: 'static', tier: 'balanced', contextWindowTokens: CONTEXT_WINDOW_TOKENS_1M },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', source: 'static', tier: 'fast', contextWindowTokens: CONTEXT_WINDOW_TOKENS_STANDARD },
];

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', description: 'Model alias or full id', enum: MODELS.map((m) => m.id) },
    effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
    permissionMode: { type: 'string', enum: ['auto', 'restricted', 'bypass'] },
    maxTurns: { type: 'integer', minimum: 1 },
    maxBudgetUsd: { type: 'number', exclusiveMinimum: 0 },
    systemPromptMode: { type: 'string', enum: ['append', 'replace'], default: 'append' },
    settingSources: { type: 'string', description: "Comma-separated --setting-sources value, e.g. 'user'" },
    extraArgs: { type: 'array', items: { type: 'string' } },
  },
};

export const adapter: RuntimeAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  capabilities,

  detect(): Promise<RuntimeDetection> { return detectBinary('claude', ['--version']); },
  async listModels(): Promise<RuntimeModel[]> { return MODELS.map((m) => ({ ...m })); },
  configSchema(): JsonSchema { return structuredClone(CONFIG_SCHEMA); },
  skillsDir(): string { return '.claude/skills'; },
  /** CLAUDE.md is a one-line pointer so AGENTS.md stays the single source of truth (§8.3). */
  instructionFiles(): string[] { return ['CLAUDE.md', 'AGENTS.md']; },

  async installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void> {
    installBundleFiles(home, bundle, {
      instructions: { 'AGENTS.md': bundle.instructions, 'CLAUDE.md': '@AGENTS.md\n' },
      skillsDir: '.claude/skills',
      extraFiles: {
        '.claude/settings.json': `${JSON.stringify({
          permissions: {
            deny: ['Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(rm -rf /:*)', 'Bash(sudo:*)'],
            additionalDirectories: [],
          },
          includeCoAuthoredBy: false,
        }, null, 2)}\n`,
      },
    });
  },

  async forkSession(base: SessionRef): Promise<SessionRef> {
    const ref = asClaudeSession(base);
    if (!ref) throw new Error('claude: cannot fork a session without a sessionId');
    // Claude forks lazily: the next turn runs `--resume <id> --fork-session` and the
    // `system/init` event reports the new id, which becomes the persisted ref.
    return { sessionId: ref.sessionId, fork: true } satisfies ClaudeSessionRef;
  },

  async describeSession(ref: SessionRef) {
    const s = asClaudeSession(ref);
    return { displayId: s?.sessionId ?? 'unknown', exists: Boolean(s) };
  },

  /** One `get_usage` control request: zero model tokens, no session, sub-second. */
  describeAccount(input: AccountProbeInput): Promise<AccountDescription> { return probeAccount(input); },

  /** The credential's expiry, read from the file. Spawns nothing and returns no token (VS-75). */
  readCredential(input: CredentialProbeInput): CredentialFacts { return readCredential(input); },

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const tmpDir = runTmpDir(input.runId);
    const built = buildArgs(input, { newSessionId: randomUUID(), tmpDir });
    writeFiles(built.files);

    const parser = createClaudeParser({ resumed: built.resumed });
    let seq = 0;
    const emit = (line: string) => {
      for (const ev of parser.handle(line)) sink.onEvent({ ...ev, seq: seq++ });
    };

    // The same resolution the account probe uses, so neither can find a different `claude`.
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
          emit(line);
          // The CLI keeps the session alive for as long as stdin is readable (VS-99); ending it the
          // moment the turn's own result line arrives is what lets the process exit on schedule.
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
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }

    const st = parser.state;
    const sessionId = st.sessionId ?? built.sessionId;
    const structured = st.structured ?? extractReport(st.finalText) ?? undefined;
    const failed = outcome.exitCode !== 0 || outcome.timedOut || st.isError;
    const error = failed
      ? classifyError(outcome.exitCode ?? 1, `${st.errorMessage ?? ''}\n${outcome.stderr}`) ?? {
        code: 'runtime_error', family: 'unknown' as const, message: st.errorMessage ?? 'claude turn failed',
      }
      : undefined;

    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      session: { sessionId },
      finalText: st.finalText,
      ...(structured !== undefined ? { structured } : {}),
      ...(st.usage
        ? { usage: { ...st.usage, ...(st.contextTokens != null ? { contextTokens: st.contextTokens } : {}), basis: 'per_turn' as const } }
        : {}),
      ...(st.costUsd != null ? { cost: { usd: st.costUsd, status: 'reported' as const } } : {}),
      ...(st.model ? { model: st.model } : {}),
      provider: 'anthropic',
      ...(error ? { error } : {}),
    };
  },
};

export { RESTRICTED_TOOLS };
export default adapter;
