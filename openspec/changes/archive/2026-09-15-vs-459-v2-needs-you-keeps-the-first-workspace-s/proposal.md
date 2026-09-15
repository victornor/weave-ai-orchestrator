# V2 Needs you follows the route's scope when you switch workspace

Tracker change for [VS-459](weave://tickets/VS-459). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: on workspace A's Needs you, switching to workspace B's Needs you keeps showing
A's decision cards; B's never appear.

`packages/ui/src/v2/NeedsYouPage.tsx` seeds its scope chip from the route once, on first mount:

```ts
const [scopeFilter, setScopeFilter] = useState<string>(() => (scope.kind === 'workspace' ? scope.ws : 'all'));
```

`/v2/w/$ws/needs` reuses the mounted `V2NeedsPage` when only the `$ws` param changes (same route
branch, `V2Workspace` re-renders but `V2NeedsPage` stays mounted). So A→B leaves `scopeFilter` at A,
and the `filtered` memo keeps matching A's decisions. The header (`V2Page`) reads the route directly
and updates, which is why the page looks like B but lists A.

## What changes

- **The scope chip follows the route.** `NeedsYouPage` derives `routeScope` from `useV2Scope()`
  (workspace id, or `all` for `/v2/needs`) and resets `scopeFilter` to it whenever `routeScope`
  changes, while the component stays mounted. Resetting during render (the "adjust state when a prop
  changes" idiom) rather than in an effect means no frame ever lists the previous workspace's cards.
- **A chip picked on the page still works.** A chip click overrides the filter within the current
  route; the next route change resets it again. Nothing in this changes the chips' behaviour or the
  URL.
- **Audit the other scope-bearing V2 screens.** `LivePage`, `MapPage`, `RunsPage`, `Work`,
  `RolesPage`, `UsagePage` and the Knowledge screens were read; only `NeedsYouPage` seeds local
  state from the route scope. The findings are listed in the delivery.
- **Tests.** In `packages/ui/src/test/v2needs.test.tsx`: A→B within the mounted screen shows B's
  cards, B→Everywhere shows all, and a chip picked on the page is respected until the route changes
  again.
- **Rendered evidence.** Captures of B's Needs you reached by switching from A in the rail, dark and
  light, from a real browser against a scratch daemon with two workspaces.

## Out of scope

- Any visual change to Needs you.
- URL changes (VS-456).