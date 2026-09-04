/** The one-line status bar every app carries (PLAN §14b.1). */
import React from 'react';
import { Box, Text } from 'ink';
import type { Connection } from '../hooks.js';

export function StatusBar({ left, right, connection }: { left: string; right?: string; connection?: Connection }): React.ReactElement {
  return (
    <Box justifyContent="space-between">
      <Text dimColor>{left}</Text>
      <Text dimColor>
        {right ?? ''}
        {connection && connection !== 'connected' ? <Text color="yellow">  {connection}</Text> : null}
      </Text>
    </Box>
  );
}
