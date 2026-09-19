/**
 * External compaction for Codex, through the app-server JSON-RPC protocol.
 *
 * `codex exec` has no compact subcommand, and the TUI's `/compact` only drives the app-server; the
 * app-server method is `thread/compact/start`, which needs the thread *loaded* first — a thread made
 * by `codex exec` is not. So the sequence is `initialize` → `initialized` → `thread/resume` →
 * `thread/compact/start`. Verified against codex-cli 0.154.0: the start returns `{}` and the thread
 * emits a `contextCompaction` item on a fresh turn.
 */
import { spawn } from 'node:child_process';
import type { CompactSessionInput, CompactSessionResult } from '@weave-ai/runtime-sdk';
import { childEnv, launchCommand } from '@weave-ai/runtime-sdk';
import { asCodexSession } from './session.js';

export interface RpcStep { id?: number; method: string; params?: Record<string, unknown> }

/** The exact JSON-RPC sequence the app-server needs to compact a thread it has not loaded. */
export function compactRpcScript(threadId: string): RpcStep[] {
  return [
    { id: 1, method: 'initialize', params: { clientInfo: { name: 'weave-ai', version: '1' } } },
    { method: 'initialized', params: {} },
    { id: 2, method: 'thread/resume', params: { threadId } },
    { id: 3, method: 'thread/compact/start', params: { threadId } },
  ];
}

const DEFAULT_TIMEOUT_MS = 300_000;

/** Drive `codex app-server` over stdio; resolves when `thread/compact/start` answers. Never throws. */
export async function compactCodexThread(input: CompactSessionInput): Promise<CompactSessionResult> {
  const ref = asCodexSession(input.ref);
  if (!ref) return { ok: false, via: 'rpc', error: { code: 'no_session', message: 'codex: no thread id to compact' } };
  const overlay: Record<string, string> = { ...(input.env ?? {}) };
  if (input.configHome) overlay['CODEX_HOME'] = input.configHome;
  const launch = launchCommand('codex', childEnv(overlay));

  return await new Promise<CompactSessionResult>((resolve) => {
    // VS-579: out-of-band compaction is a short-lived helper, not a worker turn, so it stays in the
    // daemon's control group — the per-worker memory scope is applied by `spawnLines` on turns.
    const child = spawn(launch.cmd, ['app-server'], { cwd: input.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CompactSessionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, via: 'rpc', error: { code: 'compact_timeout', message: 'codex app-server did not answer thread/compact/start in time' } }),
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const send = (step: RpcStep): void => {
      try { child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...step })}\n`); } catch { /* stdin gone; the timeout answers */ }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: { id?: number; result?: unknown; error?: { message?: string } };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'thread/resume', params: { threadId: ref.threadId } });
        } else if (msg.id === 2) {
          if (msg.error) finish({ ok: false, via: 'rpc', error: { code: 'thread_resume_failed', message: msg.error.message ?? 'codex: thread/resume failed' } });
          else send({ id: 3, method: 'thread/compact/start', params: { threadId: ref.threadId } });
        } else if (msg.id === 3) {
          if (msg.error) finish({ ok: false, via: 'rpc', error: { code: 'compact_failed', message: msg.error.message ?? 'codex: thread/compact/start failed' } });
          else finish({ ok: true, via: 'rpc', detail: { threadId: ref.threadId } });
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
    child.on('error', (e) => finish({ ok: false, via: 'rpc', error: { code: 'spawn_failed', message: `codex app-server could not start: ${e.message}` } }));
    child.on('close', (code) => {
      if (!settled) finish({ ok: false, via: 'rpc', error: { code: 'app_server_exit', message: `codex app-server exited (${code}) before compacting: ${stderr.trim().slice(-300)}` } });
    });
    send(compactRpcScript(ref.threadId)[0]!);
  });
}
