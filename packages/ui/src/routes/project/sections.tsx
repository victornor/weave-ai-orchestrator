/**
 * The project overview's section contract (VS-95).
 *
 * Every section is presented the same way — a stable key that is also its URL fragment, a heading,
 * and a disclosure that collapses it — and supplies only its content. A section that has no content
 * yet (History, Pull requests) is a body that renders its empty state; giving it content is a change
 * to that one file, and the page, its order and every other section stay as they are.
 */
import { useState } from 'react';
import type { Project } from '@weave-ai/shared';
import { cx } from '../../lib/cx';
import { NeedsYouSection } from './NeedsYouSection';
import { WorkSection } from './WorkSection';
import { LandingSection } from './LandingSection';
import { LandingsSection } from './LandingsSection';
import { ActivitySection } from './ActivitySection';
import { KnowledgeSection } from './KnowledgeSection';
import { HistorySection } from './HistorySection';
import { PullRequestsSection } from './PullRequestsSection';

/** What every section body is given. Nothing else: a body reads its own data through the hooks. */
export interface ProjectSectionProps {
  /** The resolved project. Never null — the page renders not-found before any section is mounted. */
  project: Project;
  /** The active workspace's canonical id, for building links. */
  ws: string;
}

export type ProjectSectionKey =
  | 'needs'
  | 'work'
  | 'landing'
  | 'history'
  | 'pulls'
  | 'landings'
  | 'activity'
  | 'knowledge';

export interface ProjectSectionDef {
  /** Stable key; also the `id` the section is addressable by. */
  key: ProjectSectionKey;
  label: string;
  /** `main` spans the wide column at the desktop breakpoint, `side` takes one. */
  column: 'main' | 'side';
  /**
   * Whether the body has no built-in limit on how much it renders, and so can grow arbitrarily tall
   * with data. A `true` section's body is capped at a share of the viewport and scrolls past it; a
   * section that already bounds its own output (see `ActivitySection`'s `SHOWN`) stays `false` and
   * gets no scrollbar it does not need.
   */
  scrollable: boolean;
  Body: (props: ProjectSectionProps) => React.ReactElement;
}

/** A section's height cap, as a share of the region the browser is showing (`--ac-app-h`). */
const SCROLL_CAP = 'max-h-[calc(var(--ac-app-h)*0.4)]';

/**
 * The shell: heading, disclosure and the anchor. It owns no data, so a body can be replaced without
 * the page learning anything about it.
 */
export function ProjectSection({
  id,
  label,
  children,
  className,
  scrollable = false,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
  scrollable?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(true);
  const bodyId = `project-section-${id}`;
  return (
    <section id={id} className={cx('ac-card flex min-w-0 flex-col scroll-mt-4', className)}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron open={open} />
          <h2 className="text-ui font-medium text-text-1">{label}</h2>
        </button>
      </div>
      {open ? (
        <div
          id={bodyId}
          className={cx('border-t border-line-1 px-3.5 py-3', scrollable && cx('overflow-y-auto', SCROLL_CAP))}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 8 8"
      className={cx('size-2 flex-none text-text-4 transition-transform duration-(--dur-fast) ease-ac', open && 'rotate-90')}
      aria-hidden
    >
      <path d="M2.5 1 6 4 2.5 7Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The sections, in the order they are shown. A phone reads this top to bottom; the desktop grid
 * lays `main` across the wide column and `side` across the narrow one, in the same order.
 *
 * `history` and `pulls` are reserved: their bodies say what will be there and nothing else, until
 * VS-96 and VS-97 give them content. A test pins this list so neither can be dropped meanwhile.
 */
export const PROJECT_SECTIONS: readonly ProjectSectionDef[] = [
  { key: 'needs', label: 'Needs you', column: 'side', scrollable: true, Body: NeedsYouSection },
  { key: 'work', label: 'Work under way', column: 'main', scrollable: true, Body: WorkSection },
  { key: 'landing', label: 'Landing', column: 'side', scrollable: true, Body: LandingSection },
  { key: 'history', label: 'History', column: 'main', scrollable: true, Body: HistorySection },
  { key: 'pulls', label: 'Pull requests', column: 'main', scrollable: true, Body: PullRequestsSection },
  { key: 'landings', label: 'Recent landings', column: 'side', scrollable: true, Body: LandingsSection },
  // Already bounded to SHOWN=12 entries (ActivitySection.tsx) independent of how much changelog
  // data exists, so it cannot grow the page and gets no scrollbar it does not need.
  { key: 'activity', label: 'Activity', column: 'main', scrollable: false, Body: ActivitySection },
  { key: 'knowledge', label: 'Knowledge', column: 'side', scrollable: true, Body: KnowledgeSection },
];
