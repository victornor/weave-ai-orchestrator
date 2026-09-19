/**
 * External compaction for OpenCode.
 *
 * OpenCode's v2 `session.compact` route is a stub in 1.18.30 (it answers
 * `Session.OperationUnavailableError`), but the v1 server route the TUI's `/compact` and the ACP
 * `compact` command drive is `POST /session/<id>/summarize?directory=<cwd>`, body
 * `{ providerID, modelID, auto }`. Verified against 1.18.30: 200 `true`, and a `{"type":"compaction"}`
 * part appears on the session.
 *
 * `opencode run` is one-shot, so there is no server to post to; this starts a short-lived
 * `opencode serve` against the same runtime home, posts once, and stops it.
 */
import { spawn } from 'node:child_process';
import type { CompactSessionInput, CompactSessionResult } from '@weave-ai/runtime-sdk';
import { childEnv, launchCommand } from '@weave-ai/runtime-sdk';
import { asOpenCodeSession } from './session.js';

/** The v1 server route that summarises a session. */
export function summarizePath(sessionId: string, cwd: string): string {
  return `/session/${encodeURIComponent(sessionId)}/summarize?directory=${encodeURIComponent(cwd)}`;
}

/** `opencode serve` reports `… listening on http://host:port`; pull the base URL out of any line. */
export function parseListenUrl(line: string): string | null {
  const match = /(https?:\/\/[^\s'"]+)/.exec(line);
  return match ? match[1]!.replace(/\/+$/, '') : null;
}

/** `provider/model` → the summarize payload's provider and model ids. */
export function splitModel(model: string | null | undefined): { providerID: string; modelID: string } | null {
  if (!model) return null;
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) return null;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

const DEFAULT_TIMEOUT_MS = 300_000;

/** Start a server on the same home the turns run on, post the summarize, stop it. Never throws. */
export async function compactOpenCodeSession(input: CompactSessionInput): Promise<CompactSessionResult> {
  const ref = asOpenCodeSession(input.ref);
  if (!ref) return { ok: false, via: 'http', error: { code: 'no_session', message: 'opencode: no session id to compact' } };
  const model = splitModel(input.model);
  if (!model) return { ok: false, via: 'http', error: { code: 'no_model', message: 'opencode: compaction needs a provider/model to summarise with' } };

  const overlay: Record<string, string> = { ...(input.env ?? {}) };
  if (input.configHome) {
    // Match the turn's own env: every XDG root and HOME point at the runtime home.
    overlay['XDG_CONFIG_HOME'] = input.configHome;
    overlay['XDG_DATA_HOME'] = input.configHome;
    overlay['XDG_STATE_HOME'] = input.configHome;
    overlay['XDG_CACHE_HOME'] = input.configHome;
    overlay['HOME'] = input.configHome;
  }
  const launch = launchCommand('opencode', childEnv(overlay));

  return await new Promise<CompactSessionResult>((resolve) => {
    // VS-579: out-of-band compaction is a short-lived helper, not a worker turn, so it stays in the
    // daemon's control group — the per-worker memory scope is applied by `spawnLines` on turns.
    const child = spawn(launch.cmd, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: input.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    let buf = '';
    const finish = (result: CompactSessionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, via: 'http', error: { code: 'compact_timeout', message: 'opencode serve did not answer in time' } }),
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const onLine = (line: string): void => {
      const base = parseListenUrl(line);
      if (!base) return;
      void fetch(`${base}${summarizePath(ref.sessionId, input.cwd)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...model, auto: true }),
      }).then(async (res) => {
        if (res.ok) finish({ ok: true, via: 'http', detail: { status: res.status } });
        else {
          const text = await res.text().catch(() => '');
          finish({ ok: false, via: 'http', error: { code: 'compact_failed', message: `opencode summarize ${res.status}: ${text.slice(0, 200)}` } });
        }
      }).catch((e: unknown) => {
        finish({ ok: false, via: 'http', error: { code: 'http_error', message: `opencode summarize request failed: ${String(e).slice(0, 200)}` } });
      });
    };
    const feed = (chunk: Buffer): void => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        onLine(line);
      }
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('error', (e) => finish({ ok: false, via: 'http', error: { code: 'spawn_failed', message: `opencode serve could not start: ${e.message}` } }));
    child.on('close', (code) => {
      if (!settled) finish({ ok: false, via: 'http', error: { code: 'serve_exit', message: `opencode serve exited (${code}) before compacting` } });
    });
  });
}
