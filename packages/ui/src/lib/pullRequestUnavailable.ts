import type { PullRequestUnavailable } from '../api/types';

/** What each reason means, in the pull requests section's own words. None of them is an error (VS-97, VS-107). */
export const UNAVAILABLE: Record<PullRequestUnavailable, string> = {
  no_forge: 'Pull requests are not available for this project: this daemon has no forge.',
  not_authenticated: 'Pull requests are not available for this project: the forge tool is not signed in on the daemon host.',
  no_clone: 'Pull requests are not available for this project: its repository has not been cloned yet.',
  unsupported: 'Pull requests are not available for this project: its forge cannot list them.',
  unreachable: 'The forge could not be reached.',
  // Diff-only (VS-107): the pull request itself is fine, but neither the forge nor the daemon's own
  // clone could produce its diff — a fork's branch the daemon never fetched, with no forge to ask.
  no_local_branch: "This pull request's diff is not available: its branch is not in the daemon's own clone, and the forge could not supply it.",
};
