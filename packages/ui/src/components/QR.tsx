import { useMemo } from 'react';
import { qrMatrix, qrSvgPath } from '../lib/qr';
import { cx } from '../lib/cx';

export function QR({ text, size = 176, className }: { text: string; size?: number; className?: string }): React.ReactElement | null {
  const svg = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(text));
    } catch {
      return null;
    }
  }, [text]);
  if (!svg) return null;
  return (
    <svg
      viewBox={`0 0 ${svg.size} ${svg.size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Authenticator QR code"
      className={cx('rounded-r6', className)}
      style={{ background: 'var(--qr-bg)' }}
      shapeRendering="crispEdges"
    >
      <path d={svg.path} fill="var(--qr-fg)" />
    </svg>
  );
}
