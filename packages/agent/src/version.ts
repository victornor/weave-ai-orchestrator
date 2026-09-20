import { createRequire } from 'node:module';

/**
 * The agent package's own version, read from its `package.json` (the same file from `src/` and `dist/`
 * inside a release), so the default `User-Agent` names the code that sent the request and never a
 * hard-coded literal. A read that fails falls back rather than throwing.
 */
function readVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = readVersion();

export function agentVersion(): string {
  return VERSION;
}

/** The User-Agent every provider request carries by default. A profile `user-agent` header replaces it. */
export function agentUserAgent(): string {
  return `weave-agent/${VERSION}`;
}