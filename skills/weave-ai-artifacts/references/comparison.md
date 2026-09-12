# Comparison playbook

For two or more options, designs, or states evaluated on the same set of dimensions — "which
storage approach", "before this change vs. after", "our retry ladder vs. the naive one". The point
of a comparison artifact is that the dimensions are visible and shared across every option; if each
option gets its own unrelated list of pros and cons, it isn't a comparison, it's several separate
write-ups that happen to be near each other.

## Technique

- **Two options, several dimensions:** a `.table` with the dimensions as rows and the options as
  columns (or vice versa — pick whichever axis has fewer entries as the columns, so rows don't get
  too wide to scan). Put the recommendation, if there is one, in its own row at the bottom rather
  than folding it into a cell.
- **Three or more options, each a self-contained unit:** a `.row` of `.card`s, one per option, each
  with the same internal structure (a short heading, then the same ordered list of dimensions) —
  same structure per card is what makes it scannable as a comparison rather than three separate
  blurbs.
- Mark the winner, if there is one, with a `.badge` on its card/column header — don't rely on prose
  ("this one is better") the reader has to hunt for.
- Every dimension gets a value for every option, even when the value is "n/a" or "not applicable" —
  a blank cell reads as an oversight, not as "doesn't apply."

## Worked skeleton (table form)

```html
<table class="table">
  <thead>
    <tr><th>Dimension</th><th>Ticket documents</th><th>Knowledge base</th></tr>
  </thead>
  <tbody>
    <tr><td>Revisioned</td><td>yes, built in</td><td>no</td></tr>
    <tr><td>Body format</td><td>arbitrary text</td><td>markdown only</td></tr>
    <tr><td>Scoped to</td><td>one ticket</td><td>whole project</td></tr>
    <tr>
      <td><strong>Recommendation</strong></td>
      <td colspan="2"><span class="badge">chosen</span> ticket documents — no format constraint, free history</td>
    </tr>
  </tbody>
</table>
```
