# Pre-submit checklist

Run through this before `ac_role_hire`. A "no" means fix it, not proceed.

- [ ] I ran `ac_role_list()` and checked every role in this project, not just the obvious one.
- [ ] No existing charter covers this work. If one partly covers it, I am updating that charter too, in the same turn.
- [ ] The role is a **kind of work**, not a person, not a ticket, and not "a second one because the first is busy".
- [ ] `scope` says both what is in and what is out, in natural language, and would route a ticket nobody has written yet.
- [ ] `scope` contains no file paths or directory globs.
- [ ] `charterSummary` is one sentence and names what the role owns.
- [ ] 5–9 responsibilities, each a deliverable rather than an activity.
- [ ] `exclusions` name the adjacent work a worker would otherwise absorb.
- [ ] Every entry in `rules` came from this project's `PROJECT.md`, not from my assumptions about the stack.
- [ ] `runtime` is the project's default, or I can state why not.
- [ ] `maxWorkers` reflects how many tickets this role should genuinely run at once.
- [ ] `sessionPolicy` is `fresh` if and only if this is a reviewer-shaped role.
- [ ] `permission.mode` is not `bypass`. (Only the human opts into that, explicitly.)
- [ ] `secrets` lists names only — I have not written a credential anywhere in this spec.
- [ ] I can tell the human, in one line each: what I hired, why the existing roles did not fit, and what happens next.
