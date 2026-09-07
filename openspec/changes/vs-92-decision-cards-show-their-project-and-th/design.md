# Design

Three questions decide this change: where a decision's project comes from, what shape an input and
its answer take, and where a secret value is allowed to sit.

## 1. Where the project comes from

`decisions` gets a nullable `project_id` referencing `projects(id)`, resolved once at create time
rather than derived on every read:

1. the ticket's project, when the decision concerns a ticket — always, and not overridable, because
   a card that names a project other than its ticket's would be a lie;
2. otherwise the `projectId` the asker passed to `ac_ask`, validated against the workspace;
3. otherwise the asker's own `projectId` claim — a worker belongs to one project and never has to
   name it;
4. otherwise null, which the surfaces render as `Workspace`.

Resolving at create is what makes the label stable: a decision raised about a ticket that is later
moved keeps saying what it was raised about, and `decisions.list` stays the single indexed read it
is today. `ALTER TABLE ADD COLUMN` is enough — the 0010 rebuild has already run, and the table is
still a leaf. Existing rows are backfilled from their ticket in the same migration; rows with no
ticket stay null, which is the honest answer for them.

The UI resolves the slug per surface from the projects list it already has (`NeedsYou` has it for
YOLO, `Chat` for the message project context, `TicketPage` through the ticket), and passes it as the
existing `projectSlug` prop. `DecisionCard` renders `projectSlug ?? 'Workspace'`, so the label is
never absent. Its header currently shows the PR link *instead of* the meta line; that becomes the PR
link *and* the meta line, since a merge approval is exactly the card where the project matters most.

## 2. The shape of an input and of an answer

Two JSON columns, `inputs_json` on the decision and `answer_inputs_json` on the answer, mirroring
how `options_json` and `answer_key` already pair up.

```ts
interface DecisionInput {
  key: string;                              // unique within the decision
  label: string;
  type: 'text' | 'multiline' | 'multiselect' | 'secret';
  required?: boolean;
  placeholder?: string;
  choices?: Array<{ key: string; label: string; description?: string }>;  // multiselect only
  secretName?: string;                      // secret only; becomes the env var name
}
type DecisionAnswerInputs = Record<string, string | string[]>;
```

`string[]` for a multi-select, `string` for everything else, and for a `secret` the string is the
secret's *name*, never its value. One map, one union, no per-type wrapper: the input's declared type
is what tells a reader how to read the value, and both the card and the conductor already have the
declaration in front of them.

Validation splits in two, and both halves live in `decisions/service.ts`:

- **at create** — keys unique and non-empty, `multiselect` has at least one choice with unique keys,
  `secret` has a `secretName` matching `^[A-Z][A-Z0-9_]{0,63}$`. A bad `inputs` is an `OcError`
  before the row exists, so a card that cannot be answered is never raised.
- **at answer** — every declared key is known, every required one is present and non-empty, every
  multi-select value is a subset of its choices, and a decision with no inputs refuses any values at
  all. Empty optional values are dropped before the map is written.

`answer()` already records the answer inside a transaction and only then runs side effects. Secrets
have to break that order: the value must be safely in the store *before* the answer is recorded, or
a failed write leaves a decision claiming a credential was collected that nobody holds. So the
secret hand-off runs first, outside the transaction; if it throws, nothing is recorded and the
decision stays open. That is the one thing in `answer()` that happens before the write.

The wake payload the asker receives gains `answerInputs` next to `answer`. Nothing else about
waking changes.

## 3. Where the value sits

`PLAN.md §21` is unambiguous: values are never in the database. That rules out an encrypted column
next to the name — and the daemon-level `auth_enc_key` pattern, where the key lives in the same
database as the ciphertext, would put the key and the value in the same backup.

So: `.agent-conductor/secrets.enc` holds a JSON object of `name → {iv, tag, body}`, AES-256-GCM,
under a 32-byte key in `.agent-conductor/secrets.key`. Both are written `0600` with an explicit
`chmod` after the write (the process umask cannot be trusted), both are inside the state directory
whose `.gitignore` is already `*`, and neither is touched by `portable.ts` (which copies
`workspace.yaml`, `roles/`, `knowledge/` and rendered tickets) or by the upgrade's database backup
(which copies `db.sqlite`).

The encryption is not there to defeat someone who already has the daemon account — it cannot. It is
there so that a copied state directory, a stray backup or a mis-scoped rsync yields a file that is
useless without the key file beside it, and so that the value never sits in plaintext next to
`db.sqlite`, which is the file everything in this system is used to copying.

Choosing the file over the OS keychain: the daemon runs headless under systemd, where libsecret has
no unlocked session to talk to, and a store that fails at boot is worse than no store. The interface
is `SecretsService`, so a keychain backend can be added behind it later.

`SecretsService.value(name)` is deliberately not on any route, tool or event — the only caller is
`roleSecretsEnv`. `list()` returns `{name, envVarName, scope, hasValue}` and nothing more.

## 4. Two rules that are easy to get wrong

**The offline queue is `localStorage`.** `NeedsYou` enqueues decision answers there when a write
fails. A body carrying a secret must never go in, so the answer path checks the decision for a
secret input before enqueuing and surfaces the failure instead. This is why the "not queued" rule is
in the spec rather than left to the implementation.

**`roleSecretsEnv` keeps its precedence.** `process.env[varName]` first, the store second. An
operator who exports a variable on the daemon host still wins, which is the behaviour that exists
today; the store only fills a name the host does not carry.

## 5. What is not being built

No delete or rotate — the ticket puts them out of scope, and `put` replacing a value is as far as
this goes. No UI for managing secrets: `PATCH /roles/:id` already accepts `secrets`, and the only
new writer is the conductor's `ac_role_set_secrets`, which refuses unregistered names so a role can
never list a secret that will silently be missing from its workers' environment.
