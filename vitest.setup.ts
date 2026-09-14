import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The suite must never talk to a live daemon. A worker developing Weave AI *inside*
// Weave AI inherits AC_RUN_TOKEN / AC_API_URL / AC_WORKSPACE_ID from its own run; tests that
// build clients or read the environment would otherwise reach the daemon that is running them.
for (const key of Object.keys(process.env)) if (key.startsWith('AC_')) delete process.env[key];

// VS-388: and it must never talk to the host's user systemd. `daemon stop`/`start`/`restart` follow
// the installed unit, so a test that reaches a real runner can `systemctl --user stop weave-ai.service`
// and take the live daemon down. Two layers, set after the AC_* purge above so the marker survives:
//   - `AC_TEST_GUARD` makes `realRun` (packages/cli/src/daemon.ts) refuse host-lifecycle commands
//     before it spawns anything; a test that accidentally reaches one fails loudly instead of acting.
//   - a throwaway `XDG_CONFIG_HOME` means `resolveInstalledUnit()` can never find the host's unit,
//     even when a test forgets to isolate its own.
process.env['AC_TEST_GUARD'] = '1';
process.env['XDG_CONFIG_HOME'] = mkdtempSync(join(tmpdir(), 'ac-test-config-'));
