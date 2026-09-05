import { useMemo } from 'react';
import { markdownToHtml } from '../lib/markdown';
import { cx } from '../lib/cx';

/** `breaks` is for composer text — see `markdownToHtml`. */
export function Markdown({ source, className, breaks }: { source: string; className?: string; breaks?: boolean }): React.ReactElement {
  const html = useMemo(() => markdownToHtml(source ?? '', { breaks }), [source, breaks]);
  return <div className={cx('ac-prose', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
