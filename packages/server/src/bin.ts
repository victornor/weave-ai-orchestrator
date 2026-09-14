#!/usr/bin/env node
/** Daemon entry point. `weave daemon start` execs this. */
import { getLogger } from '@weave-ai/core';
import { startDaemon } from './daemon.js';
import { registerPluginSdkResolveHook } from './register-plugin-sdk-hook.js';

// VS-385: before any workspace's plugins can load, so a bare `@weave-ai/plugin-sdk` import from a
// plugin living entirely outside this monorepo resolves to this release's own copy.
registerPluginSdkResolveHook();

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const boolFlag = (name: string): boolean => args.includes(`--${name}`);

startDaemon({
  configDir: flag('config-dir'), listen: flag('listen'), uiDir: flag('ui-dir'),
  // VS-143: the escape hatch out of an isolated daemon's default — see daemon-isolation/credential-scope.
  shareHostCredentials: boolFlag('share-host-credentials') || process.env.AC_SHARE_HOST_CREDENTIALS === '1',
})
  .then((daemon) => {
    getLogger('daemon').info({ publicUrl: daemon.publicUrl, loopbackUrl: daemon.loopbackUrl }, 'daemon ready');
  })
  .catch((err: unknown) => {
    getLogger('daemon').error({ err }, 'daemon failed to start');
    // The loopback listener may already be up and would keep the process alive; a failed start must exit.
    setTimeout(() => process.exit(1), 50);
  });
