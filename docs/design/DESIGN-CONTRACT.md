# Design contract (from the Claude Design mockup, v0.1 dark-first)

Source: `docs/design/mockup/AgentConductor Spec.dc.html` (+ `support.js`), imported 2026-09-04 from Claude Design project `8827627a-a5bb-43e9-b786-300ab5557592`. **The imported file is truncated at 256 KiB (the design tool's read cap); items marked ⚠ must be confirmed against the full export.** This file is the implementation contract for `packages/ui` and `packages/tui`; PLAN.md §21 defers to it.

## 1. Organising rules (from the spec's intro)

- Every screen answers, in order: what is happening · does it need me · what do I do about it. State first, ownership second, action third.
- The chrome is greyscale. Colour is spent almost entirely on the nine status tokens, so a coloured pixel always means state. The accent appears only on primary actions and focus.
- Dark is the designed theme; light is authored in tokens ("not an inversion: surfaces get warmer and flatter, borders get darker relative to their surface, status hues drop in lightness to hold contrast on white").

## 2. Tokens

Fonts: Inter (400/450/500/600/700) for UI, JetBrains Mono (400/500) for machine values; `font-feature-settings: "tnum" 1, "cv05" 1`.

### Surfaces

| Token | Dark | Light |
|---|---|---|
| `--bg-0` app | `#08090B` | `#F7F8F9` |
| `--bg-1` panel | `#101114` | `#FFFFFF` |
| `--bg-2` raised | `#16181C` | `#F2F3F5` |
| `--bg-3` hover | `#1E2126` | `#EAECEF` |
| `--line-1` | `#1C1E22` | `#E6E8EB` |
| `--line-2` | `#282B31` | `#D3D6DB` |
| `--text-1` | `#E9EAEC` | `#16181C` |
| `--text-2` | `#9CA1AA` | `#61656C` |
| `--text-3` | `#6B7078` | `#8A8F98` |
| `--accent` | `#5E6AD2` (link `#7C87F0`, hover `#9AA3F5`) | `#4A55C4` |

Other greys seen in components (dark): `#0C0D10` input bg, `#131519`, `#33373D`, `#383C44`, `#4E535B` disabled text, `#5A5F67` inactive nav, `#C6CAD1` secondary strong text, `#D8DBE0`, `#F2F3F5` heading text.

### Type scale

| Name | Size | Weight | Tracking | Sample |
|---|---|---|---|---|
| display/28 | 28px | 600 | -.02em | Workspace |
| title/20 | 20px | 600 | -.015em | Dark mode |
| head/16 | 16px | 600 | -.01em | Plan approval |
| body/14 | 14px | 400 | 0 | Rebased onto main (desktop body is 13px) |
| ui/13 | 13px | 450 | 0 | Backend Engineer |
| meta/12 | 12px | 400 | 0 | 2 minutes ago |
| micro/11 | 11px | 500 | .02em | IN REVIEW (uppercase) |
| mono/12 | 12px | 400 | 0 | `ACME-42 · 18.4k tok · $0.41` |

### Space, radii, motion

- Space scale: 2 · 4 · 6 · 8 · 12 · 16 · 24 · 32 · 48.
- Radii: r4 control · r6 card · r8 sheet · pill (999px). Phone frames use 26px device corners only.
- Motion: 80 ms hover/press · 120 ms panel/sheet · 150 ms max · easing `cubic-bezier(.2,.8,.3,1)` · reduced-motion → 0 ms, opacity only.
- Focus ring: `0 0 0 3px rgba(94,106,210,.16)` with accent border.

### Status set (nine tokens; one glyph + one hue each, identical in badges, rows, cards, charts, transcript lines)

Observed dark hues from the scenario and component data (⚠ light variants, exact glyph clip-paths and the `owner` captions are in the truncated tail; confirm from the full export):

| Status | Dark | Glyph (from spec text) |
|---|---|---|
| idle | `#8A8F98` | |
| working | `#E9A23B` | triangle up, filled |
| stalled | `#C98A2E` | same triangle, hollow and dashed ("the shape says this was running, the fill says it still is") |
| blocked | `#FF6B4A` | |
| needs-you | `#7C87F0` | deliberately shares the accent hue: the only status that is a request to the human, reads button-adjacent |
| merging | `#A472F5` | |
| done | `#3FB950` | |
| failed | `#E5484D` | |
| paused | ⚠ (likely `#6B7078`) | |

Rule: `needs-you` is the only coloured status that uses the accent family; everything else in the chrome stays greyscale.

## 3. Navigation

- Phone: bottom bar with five tabs (Chat · Board · Team · Needs you · More) and **Start Work** as a circular action floating above the bar centre. "Six targets do not fit at 390px."
- Desktop: left rail with keyboard numbers: Chat `1`, Needs you `2` (badge count), Board `3`, Team `4`, Runs `5`, Usage `6`, Knowledge `7`, Settings `,`. Project list under the rail (web, api, infra) with per-project colour and open count; the rail is the only place all projects appear at once.
- After sign-in the app lands on **Needs you**, not Chat ("signing in from a phone is almost always prompted by something waiting").
- `⌘K` palette: Open ticket (⏎), Create ticket (C), Set status (S), Filter board (F), Switch workspace (⌘⇧O); `⇥` scopes to a project.

## 4. Components (built once, reused everywhere)

- **Composer**: idle / dictating (live editable transcript, timer) / queued ("Conductor is replying — your message is queued", queue count). In the conductor chat it also carries a compact project select above the input ("All projects" plus each non-archived project), defaulting to the project the thread last used; the message it sends shows that project as a chip beside its timestamp. Mic: tap-to-toggle on phone, **push-to-talk on `⌘⇧M`** on desktop ("a desk user never leaves a hot mic open"). When dictation is unavailable the mic stays, dimmed with a slash, and explains itself on tap.
- **Decision card**: header "Needs you", ticket · project, title, one-line rationale, body per variant, primary action bottom-left inside a **44 px thumb band**. Variants: plan approval (a collapsed **Read the plan** disclosure over the buttons — the ticket's `plan` document at HEAD, or "the proposal is missing or empty" when there is none; Approve / Revise… / ✕; Revise opens the composer pre-scoped to the plan), merge approval (PR link, CI n/n, +adds −dels, files; Approve merge / Hold), hire approval (role · project, charter line, runtime · model, Switch runtime; Hire / Reject), worker question (options with a PICKED recommendation and one-line consequences; "Something else…" free text), discard worktree (destructive; type the ticket id to confirm). One decision per card.
- **Ticket card**: identifier, tokens · cost, title, KIND, worker, age. **Worker card**: avatar initials, name, project · ticket, status, last line ("running vitest — 38/41 passed"), worktree state (`● dirty ↑3 ↓0`), tokens, cost with `est` label. **Chips**: ticket chip, worker chip with status, `/talk ACME-42` command chip.
- **Transcript line types**: assistant text; tool call collapsed (`▸ Read src/theme/tokens.ts 0.4s`) and expanded (`▾ Edit … +18 −2` with a diff block); phase line (`phase: implementing · 4m12s · 18.4k tok`); status line (`asked you a question · waiting 2m`).
- **Window / grain picker** (shared by Usage panels): windows 24h · today · week · month · custom; grains hour · day · week. **Budget meter**: `web · project KB · 7.2k / 12k tok · curated 2d ago · next in 5d`, turns amber at "curation due".
- **Empty / loading / error**: "Nothing needs you right now. 3 workers running."; skeletons keep row rhythm; errors show a typed code (`RUNTIME_UNREACHABLE`), one sentence, and actions (Retry · Switch runtime).
- **Remote-access components**: six-box TOTP input (52 px tall, paste fills all six, caret box carries the focus ring); device row (name, kind web/CLI/presenter, IP, last seen; the current device marked by an accent edge, not a different row shape; Revoke with 5 s undo); connection banner (see §6).

## 5. Screens (all present in the mockup as phone + desktop frames)

Chat · Needs you (inbox, arrival toast, empty) · Board (phone: status filter + list; desktop: kanban with six columns; table view exposes all eleven statuses) · Ticket page (Overview, Plan with inline approve, Activity with composer, Work, Usage) · Team + Worker page · Usage + Runs · Knowledge + Settings · Onboarding (chat with a 3/5 progress bar and answer chips), `⌘K`, state matrix · Knowledge & Specs (KB cards with size/budget meters; capability list; capability page with inline ADDED/MODIFIED/REMOVED deltas; change page; graph on desktop, "selected node then its neighbours as a list" on phone and in the TUI) · Remote access (sign in → TOTP → remember device; first-run set-password; lockout countdown; Security & Devices; connection states; notification opt-in; dictation unavailable).

Board columns fold the eleven statuses into six owner-naming columns; backlog, proposing, approved, merging and cancelled fold into their neighbour with the exact status printed on the card.

Not drawn at this fidelity (designer's list): desktop Board table view, desktop Runs timeline, Channels and Plugins settings, light-theme variants of Knowledge & Specs and Remote access, archived-change variant of the Change page.

## 6. Connection states

| State | Treatment |
|---|---|
| connected | nothing shown |
| reconnecting | 24 px banner under the header, `#E9A23B` on 8 % tint; no modal, lists stay interactive, only writes queue |
| offline | read-only last state with capture time ("Offline — showing the state from 09:38"), composer queues with a count; decisions taken offline are queued and re-validated on reconnect |
| unreachable | full-screen only at load with `NET_DAEMON_UNREACHABLE · last seen 3m ago`, Retry · Change server; mid-session it degrades to the offline banner |

Login errors are typed: `AUTH_BAD_CREDENTIALS` (attempts left), `AUTH_LOCKED` (countdown in place), `AUTH_SESSION_EXPIRED` (queued messages preserved), `NET_DAEMON_UNREACHABLE`.

Notifications: opt-in browser permission prompt phrased in outcomes; Settings toggles Decisions (on), Landed work (on), Everything else (off).

## 7. Designer's calls adopted into the plan

1. Notifications: in-app arrival (toast + Needs-you badge) is the primary path; push is opt-in and nothing in any flow depends on it.
2. Specs are read-only in Knowledge (open raw · copy link · link to the ticket); the KB keeps Edit and Revert. That asymmetry teaches the rule.
3. Pending deltas are inline in the requirement list with a tinted border and one word, not a separate section.
4. Graph on phone = selected node then neighbours as a list, one hop at a time; same rendering for the TUI.
5. Sign-in lands on Needs you.
6. Offline writes and offline decisions queue like messages queued while the conductor is mid-turn; decisions are re-validated on reconnect.
7. Bottom bar: five tabs plus a floating Start Work.
8. Six board columns for eleven statuses; table view shows all.
9. `needs-you` shares the accent hue.
10. A worker question is a decision card; the answer is written back as a ticket comment.
11. Auto-merge suppresses the merge card only; plans always need the human.
12. Cost provenance shown as a share ("79 % reported") on the workspace total and as a per-model label, not a badge on every number.
13. Voice on desktop is push-to-talk (`⌘⇧M`); phone is tap-to-toggle.
14. A worker surface never shows a project switcher, cross-project search, or another project's tickets.

## 8. Implementation notes

- Tokens go into `packages/ui/src/index.css` as CSS custom properties consumed via Tailwind v4 `@theme` (non-inline for runtime theme switching); the lint gate rejects hex/px in components. The same token JSON is exported for the TUI palette.
- `packages/render` produces the view models for transcript lines, decision cards, ticket/worker cards and the briefing exactly as listed in §4, so web and TUI render the same structures.
- ⚠ To complete after the full export: the nine status tokens with light variants, glyph clip-paths and owner captions; the remaining state-matrix rows (Team, Usage, Knowledge, Settings, Login); sample data for the Spec Explorer (capabilities, requirements, change history, graph nodes, search results).
