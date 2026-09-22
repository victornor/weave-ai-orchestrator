import type {
  AccountDescription, AccountProbeInput, AgentHome, CredentialFacts, CredentialProbeInput,
  InstructionBundle, JsonSchema, RuntimeAdapter, RuntimeCapabilities,
  RuntimeDetection, RuntimeModel, SessionRef, TurnHandle, TurnInput, TurnResult, TurnSink,
} from '@weave-ai/runtime-sdk';
import { classifyError, detectBinary, installBundleFiles, launchCommand, spawnLines, writeFiles } from '@weave-ai/runtime-sdk';
import { extractReport } from '@weave-ai/shared';
import { describeCursorAccount } from './account.js';
import { buildArgs, namedModel, resumeCommand } from './args.js';
import { readCredential } from './credential.js';
import { createCursorParser } from './events.js';
import { listModels as listCursorModels, parseUnknownModelRejection } from './models.js';
import { asCursorSession } from './session.js';

export const capabilities: RuntimeCapabilities = {
  resumableSessions: true,
  forkSessions: false,
  streamingInput: false,
  systemPromptInjection: 'file_only',
  structuredOutput: false,
  mcp: true,
  usageReporting: 'none',
  costReporting: false,
  permissionModes: ['auto', 'restricted', 'bypass'],
  // VS-600: text deltas via `--stream-partial-output`; no reasoning or tool-input deltas.
  partialOutput: 'text',
  // VS-659: no image delivery path in our code; the daemon gives a readable path.
  imageInput: 'path',
};

/**
 * VS-167: `cursor-agent` has spawned and written nothing at all — not even `system.init` — within
 * this long. Well under the daemon watchdog's `silenceTimeoutSec` floor (60s, 600s default), so a
 * completely dead process fails in seconds rather than waiting for that generic backstop.
 */
const NO_OUTPUT_GRACE_MS = 20_000;

/**
 * `cursor-agent`'s `system.init.model` is a free-form display string this adapter does not pin
 * (no live CLI to verify one against). Match on the requested id's first alphabetic run so a
 * same-family run (whatever tier/variant Cursor actually picked) isn't flagged, but a different
 * model family being silently substituted (VS-187: Grok requested, Opus billed) is.
 */
function familyWord(modelId: string): string {
  return (modelId.match(/[a-z]+/i)?.[0] ?? modelId).toLowerCase();
}

function modelFamilyMismatch(requested: string, reported: string | null): boolean {
  return reported != null && !reported.toLowerCase().includes(familyWord(requested));
}

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
  async listModels(): Promise<RuntimeModel[]> { return listCursorModels(); },
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
  resumeCommand,

  async runTurn(input: TurnInput, sink: TurnSink, onHandle?: (h: TurnHandle) => void): Promise<TurnResult> {
    const built = buildArgs(input);
    writeFiles(built.files);

    const requestedModel = namedModel(input);
    const parser = createCursorParser({
      resumed: built.resumed,
      streamPartial: true,
      onPartial: (p) => sink.onPartial?.(p),
    });
    let seq = 0;
    let sawOutput = false;
    let noOutputTimedOut = false;
    let mismatchedModel: string | null = null;
    const graceMs = Math.min(
      typeof input.options?.['noOutputGraceMs'] === 'number' ? (input.options['noOutputGraceMs'] as number) : NO_OUTPUT_GRACE_MS,
      input.limits.timeoutMs,
    );
    const launch = launchCommand(built.cmd, built.env);
    const run = spawnLines({
      cmd: launch.cmd,
      args: built.args,
      cwd: input.cwd,
      env: launch.env,
      stdin: built.stdin,
      stdinMode: 'close',
      timeoutMs: input.limits.timeoutMs,
      containment: input.containment,
      onSpawn: (pid) => sink.onSpawn({ pid, pgid: pid }),
      onLine: (stream, line) => {
        sawOutput = true;
        sink.onRaw(stream, line);
        if (stream === 'stdout') {
          for (const ev of parser.handle(line)) {
            sink.onEvent({ ...ev, seq: seq++ });
            if (requestedModel && !mismatchedModel && (ev.type === 'session.started' || ev.type === 'session.resumed')) {
              const reported = (ev.payload as { model?: string | null }).model ?? null;
              if (modelFamilyMismatch(requestedModel, reported)) { mismatchedModel = reported; void run.cancel('interrupt'); }
            }
          }
        }
      },
    });
    onHandle?.({
      pid: run.child.pid ?? null,
      cancel: (mode) => run.cancel(mode),
    });

    const noOutputTimer = setTimeout(() => {
      if (!sawOutput) { noOutputTimedOut = true; void run.cancel('interrupt'); }
    }, graceMs);
    if (typeof noOutputTimer.unref === 'function') noOutputTimer.unref();

    const outcome = await run.done;
    clearTimeout(noOutputTimer);
    parser.finish();

    const st = parser.state;
    const structured = extractReport(st.finalText) ?? undefined;
    // A mismatch or dead process is caught here, ahead of the ordinary exitCode/isError check, so
    // the specific code below survives — `timedOut` is deliberately left untouched (whatever
    // `spawnLines` naturally returns for our own interrupt) because a true `timedOut` makes
    // `finalize()` overwrite `error` with a generic `timeout`/`tooling` pair.
    const failed = outcome.exitCode !== 0 || outcome.timedOut || st.isError || noOutputTimedOut || Boolean(mismatchedModel);
    const rejection = failed && !noOutputTimedOut && !mismatchedModel
      ? parseUnknownModelRejection(`${st.errorMessage ?? ''}\n${outcome.stderr}`)
      : null;
    const error = failed
      ? (noOutputTimedOut
        ? { code: 'no_output', family: 'tooling' as const, message: `cursor-agent produced no output within ${graceMs}ms of starting; interrupted rather than waiting out the daemon's silence window` }
        : mismatchedModel
          ? { code: 'model_mismatch', family: 'tooling' as const, message: `requested model "${requestedModel}" but cursor-agent ran "${mismatchedModel}"` }
          : rejection
            ? { code: 'unknown_model', family: 'tooling' as const, message: `requested model "${rejection.requested}" is not one cursor-agent accepts. Available models: ${rejection.available.join(', ')}` }
            : classifyError(outcome.exitCode ?? 1, `${st.errorMessage ?? ''}\n${outcome.stderr}`) ?? {
              code: 'runtime_error', family: 'unknown' as const, message: st.errorMessage ?? 'cursor turn failed',
            })
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
