/**
 * What a human runs when a runtime's login has expired (VS-769). One table, read by the daemon's
 * outage text and by the UI banner, so the two never disagree. The commands are the ones
 * `weave runtime login` already runs per runtime (packages/cli/src/commands/runtime.ts) and
 * docs/OPERATIONS.md already documents.
 */
const NATIVE_LOGIN: Record<string, string> = {
  claude: 'claude /login',
  codex: 'codex login',
  cursor: 'cursor-agent login',
  gemini: 'gemini',
  opencode: 'opencode auth login',
};

export interface RuntimeLoginFix {
  /** The daemon's own command: logs the CLI in with its config home pointed at the workspace. Run as the daemon's user, on its host. */
  command: string;
  /** The CLI's own login, for a workspace that shares the host's credentials. */
  native: string;
  /** One line a human can follow without opening the docs. */
  text: string;
}

export function runtimeLoginFix(runtimeId: string): RuntimeLoginFix {
  const command = `weave runtime login ${runtimeId}`;
  const native = NATIVE_LOGIN[runtimeId] ?? `${runtimeId} login`;
  return {
    command, native,
    text: `Run \`${command}\` on the daemon's host, as the daemon's user (the ${runtimeId} CLI's own login, \`${native}\`, does the same when the workspace shares the host's credentials).`,
  };
}
