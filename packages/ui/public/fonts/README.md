# Bundled fonts

Self-hosted so the web UI makes no request to a third-party font service. Latin subsets only, taken
unmodified from the Fontsource packages `@fontsource-variable/inter` 5.3.0 and
`@fontsource/jetbrains-mono` 5.3.0.

| Font | Files | Licence |
|---|---|---|
| Inter (variable, 100-900) | `inter-latin-wght-normal.woff2` | SIL OFL 1.1, `Inter-OFL.txt` |
| JetBrains Mono 400, 500 | `jetbrains-mono-latin-{400,500}-normal.woff2` | SIL OFL 1.1, `JetBrainsMono-OFL.txt` |

The `@font-face` rules are at the top of `packages/ui/src/index.css`.
