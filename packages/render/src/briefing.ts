/**
 * `briefingToSections` — the four-section briefing (PLAN §10.5). All four sections are always
 * present, in this order, each with an empty-state line, so the layout never jumps between renders.
 */
import type { Briefing } from '@agent-conductor/shared';
import { formatRelative, joinMeta, oneLine } from './format.js';
import { redact } from './redact.js';
import { statusGlyph } from './status.js';
import type { BriefingItem, BriefingSection, BriefingSections } from './types.js';

export interface BriefingContext { now?: Date }

export function briefingToSections(briefing: Briefing | null | undefined, ctx: BriefingContext = {}): BriefingSections {
  const now = ctx.now ?? new Date();
  const b = briefing ?? ({} as Briefing);
  const needsYou = arr(b.needsYou);
  const landed = arr(b.landed);
  const underway = arr(b.underway);
  const queued = arr(b.queued);

  const workersRunning = underway.length;

  const sections: [BriefingSection, BriefingSection, BriefingSection, BriefingSection] = [
    section('needs-you', 'Needs you', needsYou.map((d) => ({
      id: str(d?.decisionId) ?? '',
      uiStatus: 'needs-you' as const,
      glyph: statusGlyph('needs-you'),
      primary: oneLine(redact(str(d?.title) ?? 'Decision'), 100),
      secondary: str(d?.recommendation) ? `Recommended: ${oneLine(redact(str(d?.recommendation)!), 80)}` : null,
      meta: joinMeta(str(d?.kind)?.replace(/_/g, ' '), formatRelative(str(d?.createdAt), now)) || null,
      ref: str(d?.decisionId) ?? null,
    })), workersRunning === 0 ? 'Nothing needs you right now.' : `Nothing needs you right now. ${workersRunning} worker${workersRunning === 1 ? '' : 's'} running.`),

    section('landed', 'Landed', landed.map((l) => ({
      id: str(l?.ticketId) ?? '',
      uiStatus: 'done' as const,
      glyph: statusGlyph('done'),
      primary: oneLine(redact(str(l?.title) ?? ''), 100),
      secondary: str((l as { prUrl?: string })?.prUrl) ?? null,
      meta: joinMeta(str(l?.identifier), formatRelative(str(l?.completedAt), now)) || null,
      ref: str(l?.identifier) ?? str(l?.ticketId) ?? null,
    })), 'Nothing landed in this window.'),

    section('underway', 'Underway', underway.map((u) => ({
      id: str(u?.workerId) ?? '',
      uiStatus: 'working' as const,
      glyph: statusGlyph('working'),
      primary: oneLine(redact(str(u?.title) ?? ''), 100),
      secondary: str(u?.lastStatus) ? oneLine(redact(str(u?.lastStatus)!), 90) : null,
      meta: joinMeta(str(u?.identifier), str(u?.workerName), str(u?.status)) || null,
      ref: str(u?.identifier) ?? str(u?.ticketId) ?? null,
    })), 'No workers are running.'),

    section('queued', 'Queued', queued.map((q) => ({
      id: str(q?.ticketId) ?? '',
      uiStatus: 'idle' as const,
      glyph: statusGlyph('idle'),
      primary: oneLine(redact(str(q?.title) ?? ''), 100),
      secondary: str(q?.reason) ? oneLine(redact(str(q?.reason)!), 90) : null,
      meta: str(q?.identifier),
      ref: str(q?.identifier) ?? str(q?.ticketId) ?? null,
    })), 'Nothing is waiting to start.'),
  ];

  const headline = needsYou.length > 0
    ? `${needsYou.length} decision${needsYou.length === 1 ? '' : 's'} waiting · ${workersRunning} running · ${landed.length} landed`
    : `Nothing needs you · ${workersRunning} running · ${landed.length} landed`;

  return {
    headline,
    sections,
    warnings: arr(b.warnings).map((w) => oneLine(redact(String(w)), 160)).filter(Boolean),
    generatedAt: str(b.generatedAt) ?? new Date(now).toISOString(),
  };
}

function section(key: BriefingSection['key'], title: string, items: BriefingItem[], emptyLine: string): BriefingSection {
  return { key, title, count: items.length, empty: items.length === 0, emptyLine, items };
}

function arr<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined) : [];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
