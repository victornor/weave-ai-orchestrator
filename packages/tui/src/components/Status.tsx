/** Status glyph + label, identical semantics to the web (design contract §2). */
import React from 'react';
import { Text } from 'ink';
import { statusGlyph, statusInkColor, statusLabel } from '@agent-conductor/render';

export function StatusGlyph({ status }: { status: string | null | undefined }): React.ReactElement {
  return <Text color={statusInkColor(status)}>{statusGlyph(status)}</Text>;
}

export function StatusBadge({ status }: { status: string | null | undefined }): React.ReactElement {
  return (
    <Text color={statusInkColor(status)}>
      {statusGlyph(status)} {statusLabel(status)}
    </Text>
  );
}
