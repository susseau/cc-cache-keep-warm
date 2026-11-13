// The line above the prompt, drawn from a ready LineModel.
import type { EngineInterface } from 'claude-code'

import { BAR_CELLS, type LineModel } from './line-model'

const BAR_FULL = '▰'
const BAR_EMPTY = '▱'
// Space between the details, in the surface's own units (columns on the terminal).
const DETAIL_GAP = 2

export type LineComponents = ReturnType<EngineInterface['ui']['resolve']>

// Each detail is its own element and the spacing comes from the layout (column gaps), which
// no surface squeezes the way it squeezes runs of spaces inside one text. In a narrow window
// nothing wraps: the time and the button keep their size and the details are cut at the edge.
export function drawLine({ Box, Button, Text }: LineComponents, model: LineModel, onToggle: () => void) {
  return (
    <Box alignItems="center" flexWrap="nowrap">
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" flexWrap="nowrap" alignItems="center" columnGap={DETAIL_GAP}>
        <Box flexShrink={0}>
          {model.isGreen ? <Text color="green" bold>{model.circle}</Text> : <Text dimColor>{model.circle}</Text>}
        </Box>
        <Box flexShrink={0}>
          {model.isGreen ? <Text color="green">{BAR_FULL.repeat(model.filledCells)}</Text> : <Text dimColor>{BAR_FULL.repeat(model.filledCells)}</Text>}
          <Text dimColor>{BAR_EMPTY.repeat(BAR_CELLS - model.filledCells)}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text bold>{model.main}</Text>
          <Text dimColor>{model.expiresText}</Text>
        </Box>
        {model.details.flatMap(detail => [
          <Box flexShrink={0}><Text dimColor>·</Text></Box>,
          <Box flexShrink={0}><Text dimColor>{detail}</Text></Box>,
        ])}
      </Box>
      {model.canToggle && (
        <Box flexShrink={0}>
          <Button key="toggle" label={model.isOn ? 'Stop' : 'Keep warm'} onPress={onToggle} />
        </Box>
      )}
    </Box>
  )
}
