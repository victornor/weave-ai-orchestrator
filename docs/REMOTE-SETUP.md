# Remote setup: a daemon on a server, work from a laptop and a phone

This was "Quickstart B" in the README. Install first as described in the [README](../README.md#install).

The daemon host is where code runs, where the coding CLIs live, and where git credentials live.
The easiest safe network is a tailnet: bind to the machine's Tailscale address and every device
you own can reach it, nothing else can.

On the **server**:

```bash
# Install as in the README, then configure the listener (Tailscale example; use 0.0.0.0 for a LAN/VPS).
mkdir -p ~/.config/weave
cat > ~/.config/weave/daemon.yaml <<'YAML'
version: 1
http:
  listen: 100.x.y.z:7433                          # `tailscale ip -4`
  publicUrl: https://myhost.tailnet-name.ts.net:7433   # `tailscale status` shows the MagicDNS name
  tls:
    mode: tailscale            # a browser-trusted Tailscale certificate; see docs/OPERATIONS.md for the
                               # one-time setup. Or "self-signed" (pin with --pin), or "files" behind Caddy/nginx
auth:
  loopbackTrusted: false
YAML

weave daemon start                # "public listener held" until a password exists — expected
weave daemon set-password         # opens the public listener in place
weave login https://myhost.tailnet-name.ts.net:7433 --device server   # a local context for this host (add --pin with tls.mode self-signed)
weave doctor                      # everything on this host; `--install` for what is missing

# Host-only setup: coding CLIs, git, forge.
weave runtime login claude        # only if the inherited credentials are not enough
gh auth login
ssh-keygen -t ed25519          # and add the key to the forge

weave init ~/Work/acme --prefix ACME --name "Acme Labs"
weave project add git@github.com:acme/api.git --runtime claude

weave daemon stop                 # hand the daemon to systemd
weave daemon install-service      # prints: daemon-reload, enable --now, loginctl enable-linger
```

A firewall on the server must let the Tailscale interface reach the port, e.g.
`sudo ufw allow in on tailscale0 to any port 7433 proto tcp`.

On your **laptop** (CLI only, no daemon; macOS shown, Linux is the same minus brew):

```bash
brew install mise tailscale            # tailscale: join the same tailnet as the server
git clone git@github.com:victornor/weave-ai-orchestrator.git && cd weave-ai-orchestrator
mise install && pnpm install && pnpm build
mkdir -p ~/.local/bin && cat > ~/.local/bin/weave <<EOF
#!/bin/sh
exec "$(mise which node)" "$PWD/packages/cli/dist/bin.js" "\$@"
EOF
chmod +x ~/.local/bin/weave               # and make sure ~/.local/bin is on PATH in ~/.zshrc

weave login https://myhost.tailnet-name.ts.net:7433 --pin --device macbook
# --pin shows the daemon's certificate fingerprint and stores it; compare it with
# `weave login` output on the server before typing the password. Then the password,
# then a TOTP code if you enabled TOTP.

weave doctor                              # local tools here, plus "daemon host:" rows for the server
weave chat                                # talk to the weaver
weave top                                 # live agents
weave presenter --surface tmux            # workers as tmux windows on the laptop (hyprland on Linux)
```

**Dashboard** from the laptop: open `https://myhost.tailnet-name.ts.net:7433` in the browser.
The certificate is self-signed, so the browser warns once — Safari: *Show Details → visit this
website*; Chrome: *Advanced → proceed*. Sign in with the operator password. To make the warning
go away for good and enable "Add to Dock" as an app, trust the certificate once:

```bash
# on the laptop, after the first `weave login --pin`
openssl s_client -connect myhost.tailnet-name.ts.net:7433 -servername myhost.tailnet-name.ts.net </dev/null 2>/dev/null \
  | openssl x509 -out ~/Downloads/weaver.crt
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/weaver.crt
```

`weave login` stores a named context in `~/.config/weave/contexts.yaml` (URL, token, default
workspace, cert pin). Every command then works identically against a local or remote daemon.

On your **phone**: open `https://myhost.tailnet-name.ts.net:7433`, accept the self-signed
certificate once, sign in, install the PWA. Same state as the laptop and Telegram. Enable TOTP in
Settings → Security before exposing the daemon beyond a tailnet.

**Telegram** (optional). Put the bot token in `workspace.yaml` as an environment reference and set
the variable on the daemon host:

```yaml
channels:
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}
    allowedUserIds: [12345678]
conductor:
  channels: [web, cli, telegram]
```
