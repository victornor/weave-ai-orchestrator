import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export * from './protocol.js';
export * from './types.js';
export { Session, type SessionRef } from './session.js';
export { SseParser } from './sse.js';
export { requestOptions } from './profile.js';

/** The child entry file next to this module: `bin.js` in a build, `bin.ts` when the package is loaded from source. */
export function agentEntryPath(): string {
  const js = fileURLToPath(new URL('./bin.js', import.meta.url));
  return existsSync(js) ? js : fileURLToPath(new URL('./bin.ts', import.meta.url));
}
