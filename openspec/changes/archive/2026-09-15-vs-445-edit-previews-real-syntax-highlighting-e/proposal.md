# Edit previews get real syntax highlighting everywhere

Tracker change for [VS-445](weave://tickets/VS-445). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Captain sees only green/red washes in file-edit previews; the code itself is one uniform ink. Two
independent causes, both in `packages/ui`:

1. **The token colour rules never reach the chat/Live edit previews.** The `.hljs-*` rules in
   `src/index.css` are scoped to `.ac-diff-code`, and that class is only on the two PR-diff
   containers (`routes/project/PullRequestDiff.tsx`, `v2/project/PullRequestsSection.tsx`). The
   shared `EditPayloadBody` / `WrittenFile` (`components/Transcript.tsx`) and the `DiffHunks`
   roots render `hljs-*` spans with no scope class, so every token inherits the line ink.
2. **Where the rules do apply, V2's Mono theme greys them out.** The rules colour keywords with
   `--accent-link`, titles/built-ins with `--accent`, strings with `--status-done`, numbers/types
   with `--text-1`. Under `.v2-root` those tokens are greyscale, so a V2 PR diff is monochrome too.

Language coverage is also narrow: `lib/highlight.ts` imports `highlight.js/lib/common` (36
languages) once, and `languageForPath` maps a fixed 40-entry extension table, so Go, Rust, C#,
Kotlin, YAML, shell and most others already work but many common types do not, and a `Dockerfile`
or `Makefile` is plain text.

## What changes

- **A dedicated syntax palette.** New `--syntax-*` tokens — keyword, string, number, function,
  type, comment, attr, builtin, meta, punctuation — defined for V1 dark, V1 light, V2 (Mono) dark
  and V2 (Mono) light, and mapped through `@theme inline`. The `.hljs-*` rules point at them and
  never at `--accent*` / `--status-*`, so Mono's own accent and status tokens stay greyscale. Values
  are picked to be mutually distinguishable and readable over both `--diff-add-bg` and
  `--diff-remove-bg`.
- **One code scope that every preview carries.** The `.hljs-*` rules move from `.ac-diff-code` to
  `.ac-code`, and `DiffHunks` (both `UnifiedHunk`/`SplitHunk`), `WrittenFile`, the V1 and V2 PR
  diff containers all carry it. The diff views keep their existing class too, so nothing else moves.
- **Per-language lazy grammars.** `lib/highlight.ts` drops `highlight.js/lib/common` for
  `highlight.js/lib/core` plus one `highlight.js/lib/languages/<id>.js` dynamic import per language,
  registered on first use and cached, so the main bundle does not grow and a grammar loads when a
  file of that type first appears. The hook takes the language and returns a stable highlight
  function that escapes until the grammar is ready and re-renders once it lands.
- **A much wider `languageForPath`:** ts/tsx/js/jsx/mjs/cjs, py, go, rs, cs, java, kt, swift, rb,
  php, c/h/cpp/hpp, scala, dart, lua, sql, sh/bash/zsh/fish, ps1, yaml/yml, toml/ini, json/jsonc,
  xml/html, css/scss/less, md, graphql, proto, dockerfile, makefile, nginx conf, diff — plus
  well-known file names (`Dockerfile`, `Makefile`, `.env`-style, shell rc files). Unknown
  extensions stay escaped plain text. Any language highlight.js does not ship is named in the
  delivery rather than silently mapped to a wrong grammar.
- **Tests:** `languageForPath` over the extension and file-name tables; a grammar registering on
  first use and the line gaining `hljs-*` spans; an unknown extension staying plain text; and a
  token check that the syntax tokens are defined, distinct and non-grey in V2 dark and light.

## Out of scope

The diff layout itself (VS-419's tokens and `DiffHunks` geometry), the trace streaming (VS-440),
the Plan modal conversation (VS-442), and any Mono theme change to the accent or status palettes.