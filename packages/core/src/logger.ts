import pino from 'pino';
import type { LogDomain } from '@openconductor/shared';
export type Logger = pino.Logger;
let root: pino.Logger | null = null;
export function initLogger(level: string = process.env.OC_LOG_LEVEL ?? 'info', destination?: string): pino.Logger {
  root = pino({ level, base: { pid: process.pid } }, destination ? pino.destination({ dest: destination, sync: false }) : pino.destination(2));
  return root;
}
export function getLogger(domain: LogDomain, extra: Record<string, unknown> = {}): pino.Logger {
  if (!root) initLogger();
  return root!.child({ domain, ...extra });
}
