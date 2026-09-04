/** Renders `@agent-conductor/render` transcript blocks. The web renders the same models as widgets. */
import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptBlock } from '@agent-conductor/render';

export function TranscriptView({ blocks, expanded, maxLines }: { blocks: TranscriptBlock[]; expanded?: Set<string>; maxLines?: number }): React.ReactElement {
  const visible = maxLines && blocks.length > maxLines ? blocks.slice(blocks.length - maxLines) : blocks;
  return (
    <Box flexDirection="column">
      {visible.map((block) => (
        <TranscriptLine key={block.id} block={block} expanded={expanded?.has(block.id) === true} />
      ))}
    </Box>
  );
}

export function TranscriptLine({ block, expanded }: { block: TranscriptBlock; expanded: boolean }): React.ReactElement | null {
  switch (block.kind) {
    case 'text':
      return <Text>{block.text}</Text>;
    case 'thinking':
      return <Text dimColor italic>{block.text}</Text>;
    case 'tool':
      return (
        <Box flexDirection="column">
          <Text>
            <Text dimColor>{expanded ? '▾' : block.status === 'pending' ? '·' : '▸'} </Text>
            <Text color={block.status === 'error' ? 'red' : block.status === 'denied' ? 'yellow' : undefined}>{block.collapsed}</Text>
          </Text>
          {expanded && block.detail ? <Text dimColor>{indent(block.detail)}</Text> : null}
        </Box>
      );
    case 'file':
      return (
        <Box flexDirection="column">
          <Text>
            <Text dimColor>{expanded ? '▾' : '▸'} </Text>
            <Text color="cyan">{block.collapsed}</Text>
          </Text>
          {expanded && block.diff ? <Text dimColor>{indent(block.diff)}</Text> : null}
        </Box>
      );
    case 'phase':
      return <Text dimColor>{block.text}</Text>;
    case 'status':
      return <Text color={block.tone === 'error' ? 'red' : block.tone === 'warn' ? 'yellow' : undefined} dimColor={block.tone === 'info'}>{block.text}</Text>;
    case 'error':
      return <Text color="red">error{block.code ? ` ${block.code}` : ''}: {block.message}</Text>;
    default:
      return null;
  }
}

function indent(text: string, prefix = '    '): string {
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n');
}
