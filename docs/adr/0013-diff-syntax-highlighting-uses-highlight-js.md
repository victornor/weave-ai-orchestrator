# ADR 0013 — The PR diff viewer highlights with `highlight.js`, not a hand-written tokenizer

**Status:** accepted · 2026-09-07 · VS-107

## Context

VS-107's design (`openspec/changes/vs-107-the-pr-explorer-shows-the-diff-itself-fi/design.md`) shipped
a small, hand-rolled per-language line tokenizer for the diff viewer, matching `lib/markdown.ts`'s
rule: a deliberately bounded subset beats a library for a fixed, known set of languages. It covered
this repository's own languages — TS/JS, JSON, YAML, Markdown, CSS, SQL, shell, HTML — and named its
own escape hatch: "revisit with a real grammar library only if a workspace's repositories outgrow this
list — an ADR, not a silent decision, if it happens."

That happened before the ticket landed. Captain (2026-09-07 18:38): this workspace also holds a C# and
React codebase, so the narrow list renders most of *that* project's diffs plain, and asked for C#,
Rust, Java, HTML, PHP, JavaScript and C++ "assuming this can be done somewhat cleanly" — with an
explicit instruction to measure the bundle cost rather than guess.

## What was measured

`highlight.js@11.12.0`'s core engine plus its own curated `highlight.js/lib/common` bundle (36
languages: bash, c, cpp, csharp, css, go, java, javascript, json, kotlin, lua, markdown, php, python,
r, ruby, rust, sql, swift, typescript, xml, yaml and more — every language captain asked for, and the
whole list this ticket's own tokenizer covered) was bundled with esbuild (`--bundle --minify`, the
same tool `packages/ui` already builds with) in a scratch directory outside this repository, no
`pnpm-lock.yaml` touched:

| Build | Minified | Gzipped |
|---|---|---|
| core engine alone | 20.8 kB | 8.6 kB |
| core + 14 hand-picked languages (this ticket's original list plus captain's) | 85.4 kB | 27 kB |
| core + `lib/common` (36 languages) | 160.3 kB | 54 kB |

Marginal cost per language, averaged: roughly 1.3 kB gzipped. None of this enters the app's main
bundle: it is dynamically imported (`import('highlight.js/lib/common')`) only when the diff viewer
actually renders a file, the same way the knowledge graph's renderer is already loaded on demand
(`Knowledge — graph tab` test, `does not load the graph renderer until its tab is opened`).

## Decision

Swap the hand-written tokenizer for `highlight.js/lib/common`, loaded lazily in `packages/ui` only.
`packages/render` keeps `parseUnifiedDiff` and its types — the daemon never highlights anything, so
the dependency does not belong where `packages/core` would inherit it. `languageForPath` maps a file
extension to one of `common`'s language ids; a file whose language `common` does not carry still
renders unhighlighted, exactly as an unrecognised language did before — correct, not degraded, the
same rule this ticket's design already established.

Per-line application is unchanged: a hunk still highlights one displayed line at a time, so a token
that spans lines (a multi-line string or comment) still renders as it would in an editor with no state
carried from the line before — the gap the original design wrote down, and captain's request did not
ask to close.

## Why not keep the hand-written tokenizer

Extending it to seven more languages, several with meaningfully different lexical rules from the
TS/JS family it was built around (C#'s verbatim strings, Rust's raw strings and lifetimes, PHP's
embedded tag switching), is exactly the maintenance cost the original design flagged as the trigger
for this ADR. The measured numbers say the library is not the "at real cost to bundle size" concern
the design warned about — 54 kB gzipped, lazy-loaded, for 36 real grammars, is cheaper than getting
seven regex sets right and keeping them right.

## Consequences

- `packages/ui` gains its first syntax-highlighting dependency; `packages/render`'s `highlight.ts`
  and its test are removed — `diff.ts` (parsing) is the only file `PullRequestDiff.tsx` still imports
  from `@weave-ai/render`.
- Coverage is now `lib/common`'s 36 languages, not a fixed hand-picked list; a language that matters
  later and is not in `common` is a follow-up (`highlight.js` ships every other grammar too, importable
  the same way) rather than a rewrite.
- The per-line limitation is unchanged and still applies to every language, not just the ones this
  ADR added.
