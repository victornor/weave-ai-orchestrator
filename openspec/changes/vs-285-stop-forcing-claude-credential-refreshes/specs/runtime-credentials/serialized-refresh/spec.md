## REMOVED Requirements

### Requirement: At most one credential refresh is in flight per runtime per host

**Reason**: This requirement existed to serialize a refresh the daemon itself provoked ahead of a
turn's actual need. The daemon no longer provokes any refresh (VS-285), so there is no
daemon-initiated refresh left to serialize, and the singleflight this requirement described
(`inFlight` in `credentialFreshness.ts`) is deleted along with it.

**Migration**: None. A turn's own coding-CLI process still refreshes its credential on its own terms
when it actually needs to, exactly as it always has; that was never something the daemon coordinated
directly, only something this requirement's probe raced ahead of.

### Requirement: A turn spawns only once its credential is confirmed to outlast it

**Reason**: The freshness check this requirement mandated is exactly the mechanism that forced a
rotation on the owner's shared credential well ahead of natural need (`minValidMs`, 45 minutes,
regularly longer than an access token's own remaining life). Captain's own CLI session was
invalidated by this rotation while not using AgentConductor at all. The direction is strictly less
session management: a turn now simply spawns.

**Migration**: A turn whose credential genuinely cannot authenticate reports that failure through the
runtime's own output (already classified as `family: 'auth'` independently of this requirement) and
is handled by `runtime-credentials/login-outage`, unchanged. No replacement pre-spawn check is added.

### Requirement: A refresh that cannot restore a working credential is one authentication failure, not several

**Reason**: This requirement described how a *shared* refresh's failure (several agents waiting on
the one probe above) was reported. With the probe removed, there is no shared refresh outcome to
report — each turn's own authentication failure, if one occurs, is already reported as such by the
runtime adapter itself.

**Migration**: `runtime-credentials/login-outage`'s existing "first authentication failure stops the
runtime" behavior covers a turn's own authentication failure unchanged; no separate reporting path is
needed for a shared probe that no longer exists.
