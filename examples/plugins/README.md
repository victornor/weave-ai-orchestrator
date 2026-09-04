# Example plugins

Plugins are ordinary npm packages or local directories, loaded **in process** at daemon start
(PLAN §17). They are trusted code: there is no sandbox, and a plugin may not override a core
invariant (checkout and transition guards, approval ownership, the auto-merge gate, the project
boundary) because those APIs are simply not exposed.

| Example | What it registers |
|---|---|
| [`echo-channel/`](echo-channel/) | a channel adapter `echo` (logs outbound messages, produces no inbound ones) and a hook that logs every `ticket.status` event |

## Loading one

Add it to `plugins:` in the workspace's `workspace.yaml`. A relative path is resolved **against the
workspace root**, an absolute path is taken as is, and a bare name is resolved from the workspace's
own `node_modules` before the daemon's:

```yaml
version: 1
id: acme
name: Acme
ticketPrefix: ACME

plugins:
  - ./plugins/echo-channel                    # a directory inside the workspace
  - name: /srv/ac-plugins/echo-channel        # an absolute path, with config
    config:
      prefix: acme
  - "@acme/ac-plugin-jira"                    # an installed package

channels:
  echo: {}                                    # a registered channel still has to be configured
```

A directory needs a `package.json` (its `main`/`exports` entry is used) or an `index.js`. The entry
module's default export must be a `definePlugin({ id, version, apiVersion: 1, register })` object
from `@agent-conductor/plugin-sdk`; anything else is logged and skipped, and one broken plugin never
stops the daemon.

Restart the daemon after changing `plugins:` — plugins are registered once, at load.

## Writing one

```js
import { definePlugin } from '@agent-conductor/plugin-sdk';

export default definePlugin({
  id: 'my-plugin',
  version: '0.1.0',
  apiVersion: 1,
  register(host) {
    const config = host.config();          // the `config:` block from workspace.yaml
    host.registerChannel(myChannelAdapter);
    host.registerRuntime(myRuntimeAdapter);
    host.registerSurface(mySurfaceAdapter);
    host.registerWorktreeProvider(myProvider);
    host.registerForge(myForge);
    host.registerAgentTool(myTool);        // an extra ac_* MCP tool
    host.registerHook({ events: ['ticket.status'], handler: async (ev) => { /* … */ } });
    host.logger.info('registered');
  },
});
```

Hooks are called for every workspace that loads the plugin; they run after the event is durably in
the outbox, and a throwing handler is logged, never fatal. For an at-least-once HTTP feed of the
same events, use `webhooks:` instead (PLAN §17).
