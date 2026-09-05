# Tasks

- [x] 1. Add an opt-in `breaks` mode to `markdownToHtml` and to the `Markdown` component: inside a paragraph a single newline becomes a hard break, blank-line and block handling unchanged, off by default.
- [x] 2. Render both directions of a conductor chat message through `MessageBody` with `breaks`, and stop the trailing prose margin from padding the bottom of a bubble.
- [x] 3. Render ticket comments with `breaks`, leaving descriptions, plans, briefs, charters and knowledge files as they are.
- [x] 4. Tests: renderer unit tests for hard breaks, collapsed blank lines, lists and fences; chat tests for a multi-line human message, a list and a code block, plus the quote staying clamped; a core test round-tripping a multi-line body through the threads service.
