/** A decision card with numbered options (PLAN §21.2). One decision per card. */
import React from 'react';
import { Box, Text } from 'ink';
import type { CardModel } from '@weave-ai/render';

export function DecisionCardView({ card, index }: { card: CardModel; index?: number }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={card.destructive ? 'red' : 'blueBright'} paddingX={1}>
      <Text>
        <Text color={card.destructive ? 'red' : 'blueBright'} bold>{card.header}</Text>
        {card.subtitle ? <Text dimColor>  {card.subtitle}</Text> : null}
        {index !== undefined ? <Text dimColor>  [{index}]</Text> : null}
      </Text>
      <Text bold>{card.title}</Text>
      {card.rationale ? <Text dimColor>{card.rationale}</Text> : null}
      {card.body.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {card.body.map((line, i) => (
            <Text key={`${card.id}-body-${i}`}>
              {line.label ? <Text dimColor>{line.label.padEnd(9)} </Text> : null}
              <Text color={line.format === 'mono' || line.format === 'link' ? 'cyan' : undefined}>{line.value}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
      {card.options.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {card.options.map((option, i) => (
            <Box key={`${card.id}-${option.key}`} flexDirection="column">
              <Text>
                <Text bold>{i + 1}</Text>
                <Text dimColor>. </Text>
                <Text color={option.tone === 'danger' ? 'red' : option.tone === 'primary' ? 'blueBright' : undefined}>{option.label}</Text>
                {option.recommended ? <Text color="blueBright"> PICKED</Text> : null}
              </Text>
              {option.consequence ? <Text dimColor>   {option.consequence}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}
      {card.allowFreeText ? <Text dimColor>{`/d ${card.id} <text>  or  ${card.freeTextLabel ?? 'free text'}`}</Text> : null}
      {card.confirm ? <Text color="yellow">{card.confirm.prompt}</Text> : null}
      {card.answer ? <Text color="green">answered: {card.answer.key ?? card.answer.text ?? ''}</Text> : null}
    </Box>
  );
}
