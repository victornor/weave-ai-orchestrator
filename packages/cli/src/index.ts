export const PACKAGE = '@agent-conductor/cli';

export { ApiClient, ApiError, type ApiClientOptions, type RequestOptions, type SseMessage, type StreamOptions, type Subscription, type WriteSpec, type FetchLike } from './api.js';
export { buildProgram, VERSION } from './program.js';
export {
  configHome, stateHome, contextsPath, loadContexts, saveContexts, putContext, removeContext, useContext,
  currentContext, suggestContextName, findWorkspaceFile, workspaceIdFromFile, resolveWorkspaceId, DEFAULT_URL,
  type ContextEntry, type ResolvedContext,
} from './contexts.js';
export { resolveSession, type GlobalOptions, type ResolveOptions, type Session } from './resolve.js';
export { configureOutput, emit, printError, table, fields, style, type Column } from './output.js';
export { fetchCertPin, applyCertPin } from './tls.js';
export {
  resolveServerBin, startDaemon, stopDaemon, readPid, isRunning, tailLog, followLog, installService,
  renderServiceUnit, serviceUnitPath, pidFile, logFile,
} from './daemon.js';
