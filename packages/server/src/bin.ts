#!/usr/bin/env node
/** Daemon entry point. `conductor daemon start` execs this. */
import { getLogger } from '@agent-conductor/core';
import { startDaemon } from './daemon.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

startDaemon({ configDir: flag('config-dir'), listen: flag('listen'), uiDir: flag('ui-dir') })
  .then((daemon) => {
    getLogger('daemon').info({ publicUrl: daemon.publicUrl, loopbackUrl: daemon.loopbackUrl }, 'daemon ready');
  })
  .catch((err: unknown) => {
    getLogger('daemon').error({ err }, 'daemon failed to start');
    // The loopback listener may already be up and would keep the process alive; a failed start must exit.
    setTimeout(() => process.exit(1), 50);
  });
