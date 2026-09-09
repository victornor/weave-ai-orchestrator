# Running the daemon in Docker

The [`Dockerfile`](../Dockerfile) at the repo root builds a single image: the AgentConductor daemon,
its web UI, `git`, `gh` and `openspec`. Everything stateful lives in one volume at `/data`.

```
/data
├── config/          AC_CONFIG_HOME — daemon.yaml, workspaces.yaml, daemon.sqlite, daemon.json
└── workspaces/      one directory per workspace (repos, worktrees, worker homes, knowledge, db)
```

## Build and run

```bash
docker build -t agent-conductor .

docker volume create ac-data
docker run -d --name conductor \
  -p 7433:7433 \
  -v ac-data:/data \
  agent-conductor
```

The daemon listens on `0.0.0.0:7433` inside the container. It refuses to start on a non-loopback
address without an operator password unless `auth.loopbackTrusted` is set, so set one first:

```bash
docker exec -it conductor node packages/cli/dist/bin.js --url http://127.0.0.1:7433 daemon set-password
docker exec -it conductor node packages/cli/dist/bin.js --url http://127.0.0.1:7433 \
  -w '' init /data/workspaces/acme --prefix ACME --name Acme
```

Then point a browser or `conductor login http://<host>:7433` at it.

## What the image does not carry

Credentials never go in the image. The daemon host needs them at run time:

| Need | How to provide it |
|---|---|
| Coding CLI auth (claude, codex, opencode, gemini, cursor) | `docker exec -it conductor node packages/cli/dist/bin.js runtime login <id>`, or mount the host's config dir |
| `gh` auth (required for `deliveryMode: pr`) | `-e GH_TOKEN=...`, or `docker exec -it conductor gh auth login` |
| git over SSH | mount a key: `-v ~/.ssh/id_ed25519:/root/.ssh/id_ed25519:ro` |
| Channel tokens and other `${ENV}` refs in `workspace.yaml` | `-e TELEGRAM_BOT_TOKEN=...` |
| Webhook secrets (`webhooks[].secret`) | the same way — they are `${ENV}` references, never literals |

The coding CLIs themselves are **not** installed in the image: which runtimes you want, and their
licences, are your choice. Add them in a derived image, for example:

```dockerfile
FROM agent-conductor
RUN npm install -g @anthropic-ai/claude-code
```

Without any runtime installed the daemon starts, serves the API and the UI, and reports the missing
runtime through `conductor doctor` and `GET /api/runtimes`.

## TLS

The container speaks plain HTTP. Terminate TLS in front of it (nginx, Caddy, Traefik) and set

```yaml
# /data/config/daemon.yaml
http:
  publicUrl: https://conductor.example.com
  trustProxy: true          # only behind a proxy you control
```

`tls.mode: self-signed` also works if you would rather not run a proxy; `acme` is not implemented
(see `docs/OPERATIONS.md`).

## Upgrading and backups

Rebuild the image and recreate the container — `/data` survives, and the daemon migrates its
databases on start. Back up by snapshotting the volume while the container is stopped:

```bash
docker stop conductor
docker run --rm -v ac-data:/data -v "$PWD":/backup debian:12-slim \
  tar czf /backup/ac-data.tgz -C / data
docker start conductor
```

## Notes

- `--init` is worth adding (`docker run --init …`): agent runs spawn process groups, and a real init
  reaps them if the daemon is killed hard.
- The daemon writes worker homes and worktrees under each workspace directory, so give `/data`
  room — a workspace with several projects and live workers is gigabytes, not megabytes.
- Run one container per daemon. Two daemons over the same `/data` will fight over the sqlite files.
