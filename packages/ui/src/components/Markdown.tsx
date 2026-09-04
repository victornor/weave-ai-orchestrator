import { useMemo } from 'react';
import { markdownToHtml } from '../lib/markdown';
import { cx } from '../lib/cx';

export function Markdown({ source, className }: { source: string; className?: string }): React.ReactElement {
  const html = useMemo(() => markdownToHtml(source ?? ''), [source]);
  return <div className={cx('ac-prose', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
