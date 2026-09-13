/**
 * The bounds of a worker's self-scheduled wakeup and the supervisor's grace margin (VS-317).
 *
 * A worker schedules its own next turn through `weave_schedule_wakeup`; these constants are the
 * single source of truth for how short and how long that delay may be, shared by the tool's input
 * validation, the wake service that enforces it, and the stalled-worker sweep that decides when a
 * past-due self-wake no longer counts as an action path.
 */

/** The shortest delay a worker may schedule: below this the worker should just continue its turn. */
export const SELF_WAKE_MIN_DELAY_MS = 60_000;

/** The longest delay a worker may schedule: past a day it is a scheduled task, not a wakeup. */
export const SELF_WAKE_MAX_DELAY_MS = 24 * 60 * 60_000;

/**
 * How long past its scheduled time a `self_scheduled` wakeup stays an action path. The dispatcher
 * ticks every second, so a wake a minute overdue and still unclaimed means the worker has no route
 * back and the supervisor should report it stalled.
 */
export const SELF_WAKE_STALL_GRACE_MS = 60_000;
