import type { HandoverCommandResult } from '../api/types';
import { Markdown } from './Markdown';

/**
 * The offered resume command (VS-249), or the stated reason there is none. Renders the command
 * through `Markdown` as a fenced code block so it gets the existing copy-to-clipboard affordance
 * for free — no bespoke clipboard code here.
 */
export function HandoverCommand({ result }: { result: HandoverCommandResult }): React.ReactElement {
  if (!result.resumable) {
    return <p className="text-sm text-fg-2">{result.reason}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {result.landingLine ? <p className="text-xs text-fg-2">{result.landingLine}</p> : null}
      <Markdown source={`\`\`\`\n${result.command}\n\`\`\``} />
    </div>
  );
}
