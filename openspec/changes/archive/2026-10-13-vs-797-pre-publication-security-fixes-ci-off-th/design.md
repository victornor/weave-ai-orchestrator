## Context

All facts below come from the VS-796 report and a read of the code. Items marked *to reproduce* are confirmed on a scratch daemon (ephemeral port, scratch `--config-dir`, never port 7433) during apply, before the fix, and the output is recorded in the PR.

## Decisions

**CI.** Hosted `ubuntu-latest` for all jobs; the PR itself is the proof. The nightly `schedule` and `workflow_dispatch` also run hosted, so no separate runner workflow is needed and the runner is removed entirely. If a hosted run shows a test that depends on the runner (tmux, git, unzip, rsync are present on hosted images), fix the step rather than reintroducing the runner.

**node-forge.** Node's `crypto` can parse (`X509Certificate`) but not generate certificates, so a plain stdlib swap is not possible. `selfsigned` 5.x depends on `@peculiar/x509` and `pkijs`, not `node-forge`. Upgrade to it and adapt `tlsOptions` in `daemon.ts` (v5's `generate` is async and its options differ). If the upgrade cannot be done small, fall back to documenting exposure: node-forge is used only to *generate* one local certificate from our own inputs, never to parse untrusted data.

**Setup route.** `/api/auth/setup` stays an open route but rejects non-loopback peers with `forbidden`, using the same peer test as `isLoopbackRequest`. That test changes to use the *client* address: when `http.trustProxy` is true and a forwarded address is present, a request is loopback only if the forwarded client is loopback; with `trustProxy` false and a loopback TCP peer behind a proxy, the proxy-set `X-Forwarded-For`/`Forwarded` header being present marks the request non-loopback (a direct local client never sends it). The loopback listener (`deps.listener === 'loopback'`, unix socket/run tokens) is unaffected.
Rejected alternative: a printed secret. It adds an operator step to the quickstart; the loopback restriction covers the reported cases, and remote first-time setup can use `ssh -L` or `weave` on the host.

**loopbackTrusted.** `publicListenerAllowed` and the auth middleware only honour `auth.loopbackTrusted` when the bind is loopback; for a non-loopback bind the flag is ignored and the daemon logs a warning at startup. The listener is held until a password exists, as already happens without the flag.

**Pinning.** Resolve each tag to a SHA with `gh api`, record the tag as a trailing comment. Dependabot keeps them current.

## Risks

- A hosted-runner CI failure that the self-hosted runner masked: handled in this PR's own CI run.
- Demo mode (`packages/server/src/demo/index.ts`) sets `loopbackTrusted: true` on a loopback bind; it remains valid.
- `selfsigned` 5 changes generation output; existing generated certs on disk are untouched.
