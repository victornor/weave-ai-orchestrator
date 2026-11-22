/**
 * The Antigravity CLI (`agy`) runtime (VS-995, ADR 0025). Built against agy 1.5.14.
 *
 * - Every invocation runs under the agent's own `--gemini_dir` (see `args.ts`), whose
 *   `config/mcp_config.json` is rewritten each turn with exactly the run's MCP servers.
 * - No turn starts until `isolation.ts` has confirmed the flag still isolates on this binary.
 * - A missing or expired login is caught on the first stderr line (`auth.ts`) and becomes an `auth`
 *   error, which the daemon's login gate handles exactly as it does for `claude`.
 * - Every model is reported under provider `antigravity` and is never priced by model id, so an
 *   agy-routed Claude model is never mistaken for the `claude` runtime's own (design §8).
 */
import { rmSync } from 'node:fs';
import type {
  AccountDescription, AccountProbeInput, AgentHome, InstructionBundle, JsonSchema, RuntimeAdapter,
  RuntimeCapabilities, RuntimeDetection, RuntimeModel, SessionRef, TurnHandle, TurnInput, TurnResult, TurnSink,
} from '@weave-ai/runtime-sdk';
import { childEnv, classifyError, detectBinary, installBundleFiles, launchCommand, spawnLines, writeFiles } from '@weave-ai/runtime-sdk';
import { extractReport } from '@weave-ai/shared';
import { describeAgyAccount } from './account.js';
import { buildArgs, resumeCommand } from './args.js';
import { authError, isAuthFailureText, isAuthPrompt } from './auth.js';
import { createAgyParser } from './events.js';
import { checkIsolation, checkIsolationCached } from './isolation.js';
import { AGY_PROVIDER, MODELS } from './models.js';
import { asAgySession } from './session.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true,
  forkSessions: false,
  // v1 runs text prompts only; `--input-format stream-json` is a follow-up (design non-goals).
  streamingInput: false,
  systemPromptInjection: 'file_only',
  structuredOutput: true,
  mcp: true,
  usageReporting: 'per_turn',
  costReporting: false,
  permissionModes: ['auto', 'restricted', 'bypass'],
  partialOutput: 'none',
  imageInput: 'path',
  // Billed to the Antigravity subscription: never priced at a model vendor's API rates (design §8).
  estimateCostByModel: false,
  // The login lives in the OS keyring, so an isolated daemon must hide the session bus (design §3).
  hostKeyring: true,
};

const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', description: 'A family id (effort appended) or any exact id `agy models` lists' },
    effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
    permissionMode: { type: 'string', enum: ['auto', 'restricted', 'bypass'] },
    extraArgs: { type: 'array', items: { type: 'string' } },
  },
};

/** An OAuth URL agy prints with its login prompt: never stored (it carries the PKCE challenge and state). */
export function redactAuthUrls(text: string): string {
  return text.replace(/https:\/\/accounts\.google\.com\/\S*/g, '<redacted-oauth-url>');
}

export const adapter: RuntimeAdapter = {
  id: 'agy',
  displayName: 'Antigravity CLI',
  capabilities,

  async detect(): Promise<RuntimeDetection> {
    const found = await detectBinary('agy', ['--version']);
    if (found.status !== 'available' || !found.path) return found;
    const iso = await checkIsolation(found.path, childEnv());
    return iso.ok ? found : { ...found, status: 'unsupported', notes: iso.reason };
  },
  async listModels(): Promise<RuntimeModel[]> { return MODELS.map((m) => ({ ...m, efforts: [...(m.efforts ?? [])] })); },
  configSchema(): JsonSchema { return structuredClone(CONFIG_SCHEMA); },
  skillsDir(): string { return '.agents/skills'; },
  instructionFiles(): string[] { return ['AGENTS.md']; },
  resumeCommand,

  async installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void> {
    installBundleFiles(home, bundle, { instructions: { 'AGENTS.md': bundle.instructions }, skillsDir: '.agents/skills' });
  },

  async describeSession(ref: SessionRef) {
    const s = asAgySession(ref);
    return { displayId: s?.conversationId ?? 'unknown', exists: Boolean(s) };
  },

  async describeAccount(input: AccountProbeInput): Promise<AccountDescription> { return describeAgyAccount(input); },

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const built = buildArgs(input);
    const launch = launchCommand(built.cmd, built.env);
    const base = { signal: null, timedOut: false, finalText: null, provider: AGY_PROVIDER, session: built.conversationId ? { conversationId: built.conversationId } : null };

    const iso = await checkIsolationCached(launch.cmd, launch.env);
    if (!iso.ok) {
      onHandle?.({ pid: null, cancel: async () => {} });
      return { ...base, exitCode: null, error: { code: 'agy_isolation_failed', family: 'tooling', message: iso.reason } };
    }

    // Replaces the file outright: a server from an earlier turn or added by hand never survives.
    try { rmSync(built.files[0]!.path, { force: true }); } catch { /* rewritten below */ }
    writeFiles(built.files);

    const parser = createAgyParser();
    let seq = 0;
    let authPrompted = false;
    let authStderr = false;
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
        sink.onRaw(stream, redactAuthUrls(line));
        if (stream === 'stdout') {
          for (const ev of parser.handle(line)) sink.onEvent({ ...ev, seq: seq++ });
        } else if (!authPrompted && isAuthPrompt(line)) {
          // agy would now wait 60 s for a pasted OAuth code nobody can give: stop it at once.
          authPrompted = true;
          void run.cancel('kill');
        } else if (isAuthFailureText(line)) {
          authStderr = true;
        }
      },
    });
    onHandle?.({ pid: run.child.pid ?? null, cancel: (mode) => run.cancel(mode) });

    const outcome = await run.done;
    const st = parser.state;
    const conversationId = st.conversationId ?? built.conversationId;
    const structured = st.structured ?? extractReport(st.finalText) ?? undefined;
    const failed = authPrompted || outcome.exitCode !== 0 || outcome.timedOut || st.isError;
    const error = !failed
      ? undefined
      : (authPrompted || st.authFailed || authStderr)
        ? authError()
        : classifyError(outcome.exitCode ?? 1, redactAuthUrls(`${st.errorMessage ?? ''}\n${outcome.stderr}`)) ?? {
          code: 'runtime_error', family: 'unknown' as const, message: st.errorMessage ?? 'agy turn failed',
        };

    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      session: conversationId ? { conversationId } : null,
      finalText: st.finalText,
      ...(structured !== undefined ? { structured } : {}),
      ...(st.usage ? { usage: { inputTokens: st.usage.inputTokens, outputTokens: st.usage.outputTokens, cachedInputTokens: st.usage.cachedInputTokens, basis: 'per_turn' as const } } : {}),
      ...(built.model ? { model: built.model } : {}),
      provider: AGY_PROVIDER,
      ...(error ? { error } : {}),
    };
  },
};

export default adapter;
