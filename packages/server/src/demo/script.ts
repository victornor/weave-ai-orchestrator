/**
 * VS-770: the scripted runs the demo plays. A demo never starts an agent, so a "running" view is
 * driven by these events: the seed persists a prefix of a script as the run's history and the player
 * appends the rest, forever, on a timer. Each project has a script that fits its own story.
 */
export interface ScriptedEvent { type: string; stream?: string; payload: Record<string, unknown> }

const call = (id: string, name: string, input: Record<string, unknown>, result: string): ScriptedEvent[] => [
  { type: 'tool.call', payload: { id, name, input } },
  { type: 'tool.result', payload: { id, output: result } },
];
const say = (text: string): ScriptedEvent => ({ type: 'assistant.text', payload: { text } });

export const STOREFRONT_SCRIPT: ScriptedEvent[] = [
  say('Reading the cart store and the badge selector before changing anything.'),
  ...call('s1', 'Read', { file_path: 'src/cart/store.ts' }, 'export const cart = createStore(...) // 212 lines'),
  say('The badge reads the legacy count, which the bundle removal path never updates. I will derive it from the line items instead.'),
  ...call('s2', 'Edit', { file_path: 'src/cart/badge.ts', old_string: 'legacyCount', new_string: 'countLines(lines)' }, 'edited'),
  { type: 'file.changed', payload: { id: 's2', path: 'src/cart/badge.ts', change: 'modified' } },
  ...call('s3', 'Write', { file_path: 'src/cart/badge.test.ts', content: '// removing a bundle updates the badge' }, 'written'),
  { type: 'file.changed', payload: { id: 's3', path: 'src/cart/badge.test.ts', change: 'added' } },
  ...call('s4', 'Bash', { command: 'pnpm test --filter cart' }, 'Test Files  6 passed (6)\n     Tests  44 passed (44)'),
  { type: 'command.executed', payload: { id: 's4', command: 'pnpm test --filter cart', exitCode: 0 } },
  say('Cart tests pass, including the new regression test. Committing.'),
  ...call('s5', 'Bash', { command: 'git commit -am "Derive the cart badge from line items"' }, '[ac/lum-5 9be41d7] Derive the cart badge from line items'),
];

export const LEDGER_SCRIPT: ScriptedEvent[] = [
  say('Reading the rate limiter and its tests before changing the window logic.'),
  ...call('l1', 'Read', { file_path: 'src/limiter/slidingWindow.ts' }, 'export class SlidingWindow { /* 148 lines */ }'),
  say('The window resets on a fixed boundary, which lets a burst through twice. I will switch to a sliding log.'),
  ...call('l2', 'Edit', { file_path: 'src/limiter/slidingWindow.ts', old_string: 'resetAt', new_string: 'log' }, 'edited'),
  { type: 'file.changed', payload: { id: 'l2', path: 'src/limiter/slidingWindow.ts', change: 'modified' } },
  ...call('l3', 'Write', { file_path: 'src/limiter/slidingWindow.test.ts', content: '// burst across the boundary' }, 'written'),
  { type: 'file.changed', payload: { id: 'l3', path: 'src/limiter/slidingWindow.test.ts', change: 'added' } },
  ...call('l4', 'Bash', { command: 'pnpm test --filter limiter' }, 'Test Files  4 passed (4)\n     Tests  31 passed (31)'),
  { type: 'command.executed', payload: { id: 'l4', command: 'pnpm test --filter limiter', exitCode: 0 } },
  say('Limiter tests pass, including the new burst case. Committing and moving to the docs.'),
  ...call('l5', 'Bash', { command: 'git commit -am "Use a sliding log for the request window"' }, '[ac/lum-11 3f9a1c2] Use a sliding log for the request window'),
];

export const POCKET_SCRIPT: ScriptedEvent[] = [
  say('Looking at how the order history screen loads its data.'),
  ...call('p1', 'Read', { file_path: 'src/orders/OrderHistory.tsx' }, 'export function OrderHistory() { /* 96 lines */ }'),
  say('It fetches on every mount and has no cache. I will add a small on-device cache and show a stale marker when offline.'),
  ...call('p2', 'Write', { file_path: 'src/orders/orderCache.ts', content: 'export const orderCache = createCache();' }, 'written'),
  { type: 'file.changed', payload: { id: 'p2', path: 'src/orders/orderCache.ts', change: 'added' } },
  ...call('p3', 'Edit', { file_path: 'src/orders/OrderHistory.tsx', old_string: 'fetchOrders()', new_string: 'orderCache.read(fetchOrders)' }, 'edited'),
  { type: 'file.changed', payload: { id: 'p3', path: 'src/orders/OrderHistory.tsx', change: 'modified' } },
  ...call('p4', 'Bash', { command: 'pnpm test orders' }, 'Test Suites: 3 passed, 3 total\nTests:       18 passed, 18 total'),
  { type: 'command.executed', payload: { id: 'p4', command: 'pnpm test orders', exitCode: 0 } },
];

/** A scout only reads and reports. */
export const SCOUT_SCRIPT: ScriptedEvent[] = [
  say('Pulling the trace samples from Friday afternoon.'),
  ...call('c1', 'Bash', { command: 'tracectl query --service checkout --from 13:30 --to 15:00 --p95' }, 'p95: 410ms -> 880ms at 14:10'),
  say('The jump lines up with the cart summary deploy. Checking what that deploy changed on the tax-rate path.'),
  ...call('c2', 'Bash', { command: 'git log --since=Friday --oneline -- src/tax' }, '3f1e9aa Call the pricing service for tax rates'),
  ...call('c3', 'Read', { file_path: 'src/tax/lookup.ts' }, 'const quote = await pricing.quote(order) // no timeout, no cache'),
  say('The lookup now waits on pricing.quote with no timeout and no cache: 380 ms against a 90 ms baseline in the sampled traces.'),
];

/** The weaver answering captain: look up tickets, then reply. */
export const WEAVER_SCRIPT: ScriptedEvent[] = [
  { type: 'assistant.thinking', payload: { text: 'Captain asks about the CDN key rotation. Checking LUM-9 and whether the action is approved.' } },
  ...call('w1', 'weave_ticket_get', { id: 'LUM-9' }, 'LUM-9 [todo] Rotate the CDN signing key — action awaiting approval'),
  say('LUM-9 has its commands written and is waiting for your approval. Nothing runs until you approve it, and it keeps a 24 hour overlap so no signed URL breaks.'),
  ...call('w2', 'weave_ticket_comment', { id: 'LUM-9', body: 'Captain asked about this; the action approval is the only thing outstanding.' }, 'comment added'),
];

const BY_PROJECT: Record<string, ScriptedEvent[]> = { storefront: STOREFRONT_SCRIPT, ledger: LEDGER_SCRIPT, pocket: POCKET_SCRIPT, site: STOREFRONT_SCRIPT };

/** The script that fits an agent: the weaver's own, a scout's, else its project's. */
export function scriptFor(agentKind: string, projectSlug: string | null, ticketKind: string | null): ScriptedEvent[] {
  if (agentKind === 'weaver') return WEAVER_SCRIPT;
  if (ticketKind === 'scout') return SCOUT_SCRIPT;
  return BY_PROJECT[projectSlug ?? ''] ?? STOREFRONT_SCRIPT;
}
