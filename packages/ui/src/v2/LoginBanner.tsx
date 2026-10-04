import { runtimeLoginFix } from '@weave-ai/shared';
import { useRecheckRuntimeLogin, useRuntimeCredentialsMany } from '../api/hooks';
import { Button } from '../components/Button';

/**
 * VS-769: a runtime whose login expired stops every agent on it, and the agent that would say so is
 * one of them. This is the daemon saying it on every page, with the exact command, until the login
 * works again. One line per gated runtime per workspace; nothing at all when none is.
 */
export function LoginBanner({ workspaceIds }: { workspaceIds: readonly string[] }): React.ReactElement | null {
  const results = useRuntimeCredentialsMany(workspaceIds);
  const recheck = useRecheckRuntimeLogin();
  const down = results.flatMap((r, i) => (r.data ?? []).filter((c) => c.needsLogin).map((c) => ({ ws: workspaceIds[i]!, credential: c })));
  if (down.length === 0) return null;
  return (
    <div role="alert" data-testid="login-banner" className="border-b border-failed/30 bg-failed/10 text-failed">
      {down.map(({ ws, credential: c }) => {
        const fix = runtimeLoginFix(c.runtimeId);
        const pending = recheck.isPending && recheck.variables?.ws === ws && recheck.variables.runtimeId === c.runtimeId;
        const stillDown = recheck.isSuccess && !recheck.data.released && recheck.variables?.ws === ws && recheck.variables.runtimeId === c.runtimeId;
        return (
          <div key={`${ws}:${c.runtimeId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-micro">
            <span className="font-medium">
              {workspaceIds.length > 1 ? `${ws}: ` : ''}The {c.displayName} login expired — its agents are paused.
            </span>
            <span className="text-text-2">
              Run <code className="ac-mono">{fix.command}</code> on the daemon&rsquo;s host; they resume on their own.
            </span>
            {stillDown ? <span className="text-text-2">Still down{recheck.data.reason ? `: ${recheck.data.reason}` : ''}.</span> : null}
            <Button size="sm" variant="secondary" className="ml-auto" disabled={pending} onClick={() => recheck.mutate({ ws, runtimeId: c.runtimeId })}>
              {pending ? 'Checking…' : 'I fixed it — re-check'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
