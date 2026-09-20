/**
 * The live row for a terminal surface (VS-603): the same `liveTurnLine` the web row renders, so the
 * terminal never spells a live state a second way. One second of its own clock keeps "Working · 12 s"
 * ageing while nothing arrives; nothing here polls.
 */
import React from 'react';
import { Text } from 'ink';
import type { RunEvent } from '@weave-ai/shared';
import { liveActivityLine, type LiveTurnPartial } from '@weave-ai/render';
import { useNow } from '../hooks.js';

export interface ActivityLineProps {
  events: readonly RunEvent[];
  partials?: readonly LiveTurnPartial[];
  /** What the run's runtime can stream (`capabilities.partialOutput`); without it the row says "whole steps only". */
  partialOutput?: 'none' | 'text' | 'full';
  partialSince?: number | null;
  lastPartialAt?: number | null;
  /** Render nothing unless a turn is genuinely live. */
  live?: boolean;
}

/** The live line for a terminal surface at `now` — pure, so the per-state wording is testable. */
export function activityLineFor(
  events: readonly RunEvent[],
  partials: readonly LiveTurnPartial[],
  now: number,
  partialOutput: 'none' | 'text' | 'full' = 'none',
  opts: { partialSince?: number | null; lastPartialAt?: number | null } = {},
): string {
  return liveActivityLine(events, partials, now, { partialOutput, partialSince: opts.partialSince, lastPartialAt: opts.lastPartialAt });
}

export function ActivityLine({ events, partials = [], partialOutput, partialSince, lastPartialAt, live = true }: ActivityLineProps): React.ReactElement | null {
  const now = useNow(live);
  if (!live) return null;
  return <Text dimColor>{activityLineFor(events, partials, now, partialOutput, { partialSince, lastPartialAt })}</Text>;
}
