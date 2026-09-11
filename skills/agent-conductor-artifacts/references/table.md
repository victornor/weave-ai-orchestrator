# Table playbook

For structured data with enough rows or columns that prose would just be a table in disguise — a
capability matrix, a list of files with their status, a set of options with several attributes each.
If it has two columns and three rows, it's probably a couple of sentences instead.

## Technique

- `<table class="table">` — the kit's `.table` class handles width, row rules and header styling;
  don't add your own borders or striping on top of it.
- Keep the header row short and literal — one or two words per `<th>`. Long header text wraps badly
  even with `overflow-wrap: anywhere`, and a wrapped header is harder to scan than the data below
  it.
- One idea per cell. If a cell needs a sentence, that's a sign the table has the wrong columns —
  either split it into two columns, or the content isn't tabular and wants prose instead.
- Use a `<code>` inline for anything that's literally an identifier (a file path, a field name, a
  status value) rather than plain text — it's a visual promise that the reader can trust the exact
  spelling.
- A status-like column ("blocked", "done") gets the matching `.status-*` text color, optionally with
  `.status-dot`, instead of a plain word — the reader scans color before they read text.

## Worked skeleton

```html
<table class="table">
  <thead>
    <tr><th>File</th><th>Change</th><th>Status</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>packages/core/src/artifacts/kit.ts</code></td>
      <td>new</td>
      <td class="status-done status-dot">done</td>
    </tr>
    <tr>
      <td><code>packages/server/src/tools.ts</code></td>
      <td>add <code>ac_artifact_kit</code></td>
      <td class="status-working status-dot">in progress</td>
    </tr>
  </tbody>
</table>
```
