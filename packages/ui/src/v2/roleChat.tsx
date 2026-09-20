/**
 * VS-525: the one control that opens a role's persistent session, shared by the project overview's
 * Roles section and the V2 Roles screen so the two surfaces cannot disagree about what the thing is
 * called or when it is offered. The opening call is the same `usePersistentSession` open-or-resume
 * the Roles page used before this change — this module is not a second implementation of it.
 *
 * VS-581: the same open-or-resume is exposed as `useRoleChatOpen`, and a second presentation,
 * `RoleChatRow`, renders it as a child row under a project in the V2 sidebar and the phone More list.
 * The open is shared; only the chrome differs.
 *
 * The pure helpers (`roleChatActionLabel`, `roleChatStateLabel`, `roleChatBlockedReason`,
 * `sessionForRole`, `roleNavRows`) are exported so the states are testable without a browser, the
 * pattern `RolesPage.tsx` already uses for its own helpers.
 */
import type { Agent, Role } from '@weave-ai/shared';
import { useGo } from '../app/link';
import { usePersistentSession } from '../api/hooks';
import { messageOf } from '../components/States';
import { cx } from '../lib/cx';
import { statusText } from '../lib/format';
import { roleStateLabel } from '../lib/roleState';

/** The action the control offers: opening an existing conversation, or starting a new one. */
export function roleChatActionLabel(hasSession: boolean): string {
  return hasSession ? 'Open chat' : 'Start chat';
}

/** What the control says about the session's existence, beside or in the action. */
export function roleChatStateLabel(hasSession: boolean): string {
  return hasSession ? 'Conversation ready' : 'No conversation yet';
}

/**
 * Why a role cannot serve a persistent session, or `null` when it can. A role is only offered a chat
 * while it is `active`: a paused, retired or not-yet-hired role cannot serve one, so the surfaces
 * state the reason rather than presenting a control that fails on click (VS-525).
 */
export function roleChatBlockedReason(role: Pick<Role, 'status'>): string | null {
  switch (role.status) {
    case 'active':
      return null;
    case 'paused':
      return 'Paused — resume the role to chat';
    case 'retired':
      return 'Retired — no longer available to chat';
    case 'pending_activation':
      return 'Awaiting hire approval — no chat yet';
    default:
      return `${statusText(role.status)} — no chat`;
  }
}

/** The role's live persistent session in a list of session agents, or `null` when it has none yet. */
export function sessionForRole(sessions: readonly Agent[], roleId: string): Agent | null {
  return sessions.find((s) => s.kind === 'session' && s.roleId === roleId) ?? null;
}

/** How many role rows a sidebar project block shows before it summarises the rest (VS-581). */
export const ROLE_NAV_CAP = 5;

/**
 * The role rows a project's sidebar block shows, and how many it leaves to the overview. The cap
 * keeps a project with many roles tidy; the role whose session is the page currently shown is always
 * included, even past the cap, so opening a conversation never hides its own row.
 */
export function roleNavRows(
  roles: readonly Role[],
  opts: { cap?: number; activeRoleId?: string | null } = {},
): { shown: Role[]; hiddenCount: number } {
  const cap = opts.cap ?? ROLE_NAV_CAP;
  const shown = roles.filter((role, i) => i < cap || role.id === opts.activeRoleId);
  return { shown, hiddenCount: roles.length - shown.length };
}

/**
 * The worker id named by a `/w/<ws>/workers/<id>` path, or `null` (VS-581). Pure, so the sidebar's
 * "which role's conversation is open" can be tested without a router.
 */
export function workerFromRoleChatPath(pathname: string): string | null {
  const m = /^\/w\/[^/]+\/workers\/([^/]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

/**
 * The open-or-resume call every role-chat surface makes (VS-525, VS-581): resolve the role's session,
 * creating it on first use, and navigate to it. `ws` is the session's workspace — the sidebar passes
 * its project's own workspace because the shell is above the provider and spans workspaces.
 *
 * VS-617: the navigation runs from the mutation's own success, not a callback passed to `mutate`, so
 * it still fires when the surface that owns the row unmounts before the request resolves (the phone
 * More sheet closes as it opens). `onOpened` runs just before navigation, for a surface that must
 * close itself once the session is open.
 */
export function useRoleChatOpen(
  ws: string,
  onOpened?: () => void,
): {
  open: (role: Pick<Role, 'id' | 'projectId'>, workerModelId?: string) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
} {
  const go = useGo();
  const persistentSession = usePersistentSession(ws, {
    onOpened: (agent) => {
      onOpened?.();
      go('/w/$ws/workers/$workerId', { params: { ws, workerId: agent.id } });
    },
  });
  return {
    open: (role, workerModelId) =>
      persistentSession.mutate({ projectId: role.projectId, roleId: role.id, ...(workerModelId ? { workerModelId } : {}) }),
    isPending: persistentSession.isPending,
    isError: persistentSession.isError,
    error: persistentSession.error,
  };
}

/**
 * The button (or the reason there is none) that opens `role`'s persistent session. It owns the
 * open-or-resume call and the navigation to the session's worker page; the page owns the read that
 * says whether the session already exists.
 */
export function RoleChatControl({
  role,
  session,
  ws,
  workerModelId,
  className,
}: {
  role: Pick<Role, 'id' | 'projectId' | 'name' | 'status'>;
  session: Agent | null;
  ws: string;
  /** VS-526: the worker option a newly created session runs on; omitted leaves the `workers` setting. */
  workerModelId?: string;
  className?: string;
}): React.ReactElement {
  const chat = useRoleChatOpen(ws);

  const blocked = roleChatBlockedReason(role);
  if (blocked) {
    return <span className={cx('text-micro text-text-3', className)}>{blocked}</span>;
  }

  return (
    <span className={cx('inline-flex flex-col items-start gap-0.5', className)}>
      <button
        type="button"
        disabled={chat.isPending}
        title={roleChatStateLabel(session !== null)}
        onClick={() => chat.open(role, workerModelId)}
        className="flex-none text-micro text-accent-link hover:text-text-1 disabled:opacity-40"
      >
        {roleChatActionLabel(session !== null)}
      </button>
      {chat.isError ? (
        <span role="status" className="text-nano text-blocked">
          The chat was not opened: {messageOf(chat.error as Error)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A role's row in the V2 sidebar and the phone More list (VS-581), in the same child-row style as the
 * project's Roadmap row. An active role is a button that opens its persistent conversation through
 * the same `useRoleChatOpen` the shared control uses. A role that cannot chat is a static,
 * non-actionable row that carries the reason as its title and accessible name. `current` marks the
 * role whose session is the page shown.
 *
 * VS-617: `onNavigate` is called once the session is open, immediately before the shell navigates to
 * it — not on click. The phone More sheet uses it to close only on success, so closing the sheet can
 * never cancel the open, and a failed open keeps the row (and the sheet) standing with its `not
 * opened` state.
 */
export function RoleChatRow({
  role,
  session,
  ws,
  onNavigate,
  tall,
  current,
}: {
  role: Pick<Role, 'id' | 'projectId' | 'name' | 'status'>;
  session: Agent | null;
  ws: string;
  /** Called when the session has opened, just before navigating to it. */
  onNavigate?: () => void;
  tall?: boolean;
  current?: boolean;
}): React.ReactElement {
  const chat = useRoleChatOpen(ws, onNavigate);
  const blocked = roleChatBlockedReason(role);
  const rowClass = cx('v2-row v2-row-child', tall && 'min-h-11', current && 'v2-row-child-current');

  if (blocked) {
    return (
      <span
        className={cx(rowClass, 'cursor-default text-text-4')}
        title={blocked}
        aria-label={`${role.name} — ${blocked}`}
        data-role-chat-blocked={role.id}
      >
        <span className="min-w-0 flex-1 truncate">{role.name}</span>
        <span className="ac-mono flex-none text-nano">{roleStateLabel(role.status)}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={chat.isPending}
      title={roleChatStateLabel(session !== null)}
      onClick={() => chat.open(role)}
      data-role-chat-row={role.id}
      data-role-chat-current={current ? 'true' : undefined}
      className={cx(rowClass, 'disabled:opacity-40')}
    >
      <span className="min-w-0 flex-1 truncate">{role.name}</span>
      {chat.isError ? (
        <span role="status" className="flex-none text-nano text-blocked" title={messageOf(chat.error as Error)}>
          not opened
        </span>
      ) : null}
    </button>
  );
}