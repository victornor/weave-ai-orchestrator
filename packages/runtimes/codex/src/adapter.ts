import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AccountDescription, AccountProbeInput, AgentHome, InstructionBundle, JsonSchema, RuntimeAdapter,
  RuntimeCapabilities, RuntimeDetection, RuntimeModel, SessionRef, SpawnOutcome, TurnHandle, TurnInput, TurnResult, TurnSink,
} from '@weave-ai/runtime-sdk';
import { classifyError, detectBinary, installBundleFiles, launchCommand, runTmpDir, spawnLines, truncate, writeFiles } from '@weave-ai/runtime-sdk';
import { extractReport } from '@weave-ai/shared';
import { describeCodexAccount } from './account.js';
import { buildArgs, mcpConfigToml, resumeCommand } from './args.js';
import { runAppServerTurn } from './app-server.js';
import { compactCodexThread } from './compact.js';
import { createCodexParser, type CodexParseState } from './events.js';
import { sandboxWritableRoots } from './gitdir.js';
import { listModels as listCodexModels, modelContextWindow } from './models.js';
import { readThreadContextTokens, readThreadUsage } from './usage.js';
import { asCodexSession, type CodexSessionRef } from './session.js';

/** Written before the turn starts, not a reason it failed: PATH-alias and MCP-transport noise. */
const STARTER_NOISE = [/^WARNING:/, /\bERROR\s+rmcp::/, /^\s*$/];

/**
 * VS-526: the first line of a failed turn's stderr that is a reason, not startup noise. `codex exec
 * --json` writes its fatal reasons (`Not inside a trusted directory and --skip-git-repo-check was
 * not specified.`) to stderr and exits with no JSON on stdout, so the parser never sees them — the
 * adapter has to carry the words out or the run records a bare `exit_1`.
 */
export function firstStderrReason(stderr: string): string | null {
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || STARTER_NOISE.some((re) => re.test(trimmed))) continue;
    return trimmed;
  }
  return null;
}

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
  partialOutput: 'full',
  // VS-659: the app-server protocol carries image input types, but our MCP-tool-result delivery of an
  // image to the model is not established by our code; the daemon gives a readable path instead.
  imageInput: 'path',
};

/** Codex has no `--list-models`; `listModels` tries `codex debug models --bundled` first. */

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', description: 'Model id passed to `codex -m`' },
    effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], description: 'model_reasoning_effort' },
    permissionMode: { type: 'string', enum: ['auto', 'restricted', 'bypass'] },
    maxTurns: { type: 'integer', minimum: 1, description: 'Not enforced by codex; used by the supervisor only' },
    maxBudgetUsd: { type: 'number', exclusiveMinimum: 0, description: 'Not enforced by codex; used by the supervisor only' },
    mcpViaConfigFile: { type: 'boolean', default: false, description: 'Initialize MCP servers in an empty CODEX_HOME/config.toml; existing config is preserved using -c overrides' },
    toolOutputTokenLimit: { type: 'integer', minimum: 1, default: 4096, description: 'Maximum tokens retained per tool output' },
    compactionPercent: { type: 'number', exclusiveMinimum: 0, maximum: 100, default: 60, description: 'Compact at this percentage of the active model context window' },
    contextWindowTokens: { type: 'integer', minimum: 1, description: 'Override the active Codex model context window in tokens' },
    autoCompactTokenLimit: { type: 'integer', minimum: 1, description: 'Optional absolute compaction threshold; overrides compactionPercent' },
    appServer: { type: 'boolean', default: true, description: 'Drive turns through `codex app-server` for live partial output; false keeps `codex exec --json`' },
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
    return { threadId: ref.threadId, fork: true, ...(ref.usage ? { usage: ref.usage } : {}) } satisfies CodexSessionRef;
  },

  async describeSession(ref: SessionRef) {
    const s = asCodexSession(ref);
    return { displayId: s?.threadId ?? 'unknown', exists: Boolean(s) };
  },

  /** `codex app-server` → thread/resume → thread/compact/start. See `compact.ts`. */
  compactSession: compactCodexThread,

  /** From `codex debug models --bundled` (`context_window`), the same source the turn's threshold reads. */
  modelContextWindow: (model) => modelContextWindow(model),

  /** Billing mode only: Codex exposes no plan limits to a non-interactive run. */
  async describeAccount(input: AccountProbeInput): Promise<AccountDescription> { return describeCodexAccount(input); },

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const tmpDir = runTmpDir(input.runId);
    const model = input.model || (typeof input.options['model'] === 'string' ? input.options['model'] : null);
    const modelWindow = input.options['contextWindowTokens'] === undefined && input.options['autoCompactTokenLimit'] === undefined ? await modelContextWindow(model) : undefined;
    // VS-685: a git worktree's metadata lives outside the turn's cwd, so give the workspace-write
    // sandbox the checkout's git common dir (and the checkout itself when it is out of cwd).
    const writableRoots = sandboxWritableRoots(input.worktree?.path, input.cwd);
    let built = buildArgs(input, { tmpDir, modelContextWindowTokens: modelWindow, configExists: Boolean(input.configHome && existsSync(join(input.configHome, 'config.toml'))), writableRoots });
    mkdirSync(tmpDir, { recursive: true });
    rmSync(built.lastMessagePath, { force: true });
    // Runtime config is shared by workers. Never overwrite a config created by another turn
    // between the existence check and materialization. The loser uses invocation overrides.
    const configPath = input.configHome ? join(input.configHome, 'config.toml') : null;
    const configFile = built.files.find((file) => file.path === configPath);
    if (configFile && input.configHome) {
      mkdirSync(input.configHome, { recursive: true });
      try {
        writeFileSync(configFile.path, configFile.content, { flag: 'wx', mode: 0o600 });
        built.files = built.files.filter((file) => file !== configFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        built = buildArgs(input, { tmpDir, modelContextWindowTokens: modelWindow, configExists: true, writableRoots });
      }
    }
    writeFiles(built.files);

    const previous = asCodexSession(input.session.ref);
    const baseline = previous?.usage ?? readThreadUsage(input.configHome, built.threadId);
    const resumed = built.mode === 'resume';
    const parserBaseline = built.mode === 'new' ? undefined : baseline;
    let seq = 0;
    const nextSeq = (): number => seq++;
    // VS-595/VS-601: a per-turn `codex app-server` gives partial output and a tool's start. A server
    // that cannot start, or a rejected thread or turn request, returns null and `exec --json` takes the
    // turn; `options.appServer: false` opts out.
    const server = input.options['appServer'] === false ? null : await runAppServerTurn(input, sink, onHandle, built, nextSeq, { resumed, baseline: parserBaseline, model });
    let outcome: Pick<SpawnOutcome, 'exitCode' | 'signal' | 'timedOut' | 'stderr'>;
    let st: CodexParseState;
    if (server) {
      outcome = server.outcome;
      st = server.translator.state;
    } else {
      const parser = createCodexParser({ resumed, baseline: parserBaseline });
      const launch = launchCommand(built.cmd, built.env);
      const run = spawnLines({
        cmd: launch.cmd,
        args: built.args,
        cwd: input.cwd,
        env: launch.env,
        stdin: built.stdin,
        timeoutMs: input.limits.timeoutMs,
        containment: input.containment,
        onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
        onLine: (stream, line) => {
          sink.onRaw(stream, line);
          if (stream === 'stdout') for (const ev of parser.handle(line)) sink.onEvent({ ...ev, seq: nextSeq() });
        },
      });
      onHandle?.({ pid: run.child.pid ?? null, cancel: (mode) => run.cancel(mode) });
      outcome = await run.done;
      st = parser.state;
    }
    let finalText = st.finalText;
    try { finalText = readFileSync(built.lastMessagePath, 'utf8').trim() || finalText; } catch { /* codex may not have written it */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }

    let structured: unknown;
    if (input.outputSchema && finalText) { try { structured = JSON.parse(finalText); } catch { structured = undefined; } }
    if (structured === undefined) structured = extractReport(finalText) ?? undefined;

    const silentFailure = !st.completed && !st.errorMessage;
    const failed = outcome.exitCode !== 0 || outcome.timedOut || st.isError || !st.completed;
    // VS-526: `codex exec --json` writes a startup failure to stderr and exits without any JSON, so
    // the parser produces nothing and the classifier is handed `exit_1` — which it returns as the
    // code, with no message. When the stream carried no reason, take the first real line of stderr
    // so the run row, the error event and the surface all name the cause.
    const stderrReason = firstStderrReason(outcome.stderr);
    const fallbackMessage = silentFailure
      ? (stderrReason ?? `codex exited without completing the turn (status ${outcome.exitCode ?? outcome.signal ?? 'unknown'})`)
      : (st.errorMessage ?? 'codex turn failed');
    let error = failed
      ? classifyError(outcome.exitCode === 0 ? 1 : outcome.exitCode ?? 1, `${st.errorMessage ?? ''}\n${outcome.stderr}`) ?? {
        code: 'runtime_error', family: 'unknown' as const, message: fallbackMessage,
      }
      : undefined;
    // A bare `exit_N` is the classifier's catch-all and carries no reason; prefer the runtime's own
    // words (stderr) or, when it wrote none, a message that at least names the status.
    if (error && /^exit_/.test(error.code)) error = { ...error, message: fallbackMessage };
    if (error) {
      // The engine records this as the run's `error` event, which sets its failure reason — the
      // reason a later turn or the session surface reads. Emitted only on failure.
      sink.onEvent({ ts: new Date().toISOString(), type: 'error', payload: { message: truncate(error.message, 4000), code: error.code } });
    }
    const contextTokens = readThreadContextTokens(input.configHome, st.threadId ?? built.threadId);

    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      session: st.threadId ? { threadId: st.threadId, ...(st.cumulativeUsage ? { usage: st.cumulativeUsage } : {}) } : (built.threadId && built.mode === 'resume' ? { threadId: built.threadId } : null),
      finalText,
      ...(structured !== undefined ? { structured } : {}),
      // The turn's cumulative usage is not a context size; the thread's last request is. Read it from
      // the rollout so the chat's context meter has a real figure for a Codex session.
      ...(st.usage ? { usage: { ...st.usage, ...(contextTokens != null ? { contextTokens } : {}), basis: 'per_turn' as const } } : {}),
      ...(model ? { model } : {}),
      provider: 'openai',
      ...(error ? { error } : {}),
    };
  },
};

export { mcpConfigToml };
export default adapter;
