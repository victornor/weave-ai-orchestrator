import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export * from './protocol.js';
export * from './types.js';
export { SteeringQueue, type SteeringSource } from './steering.js';
export { validateAgainstSchema } from './validate.js';
export { Session, forkSessionFile, type SessionRef } from './session.js';
export { SseParser } from './sse.js';
export { requestOptions, requestHeaders } from './profile.js';

/** The child entry file next to this module: `bin.js` in a build, `bin.ts` when the package is loaded from source. */
export function agentEntryPath(): string {
  const js = fileURLToPath(new URL('./bin.js', import.meta.url));
  return existsSync(js) ? js : fileURLToPath(new URL('./bin.ts', import.meta.url));
}
export { resolveProvider, loadPreset, mergeCompat, mergeParams, paramsFromOptions, headersWithExtras, presetsDir, PRESET_NAMES, type Preset, type Resolved } from './resolve.js';
export { completeCompat, DEFAULT_COMPAT, type Compat, type Params } from './codec/params.js';
export { classifyHttp, classifyStreamError, classifyNetwork, classifyFinish, parseErrorBody, stopError, isRetryable } from './errors.js';
export { planRetry, parseRetryAfter, backoffMs } from './retry.js';
export { repairArgs } from './repair.js';
export { probeProvider, type ProbeReport, type ProbeCheck, type ProbeOptions } from './probe.js';
export { createMcpClient, testMcpServer, type McpClient, type McpClientConfig, type McpTool, type McpTestResult } from './mcp/client.js';
