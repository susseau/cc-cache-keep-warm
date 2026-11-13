// The line above the prompt, drawn from a ready LineModel.
import type { EngineInterface } from 'claude-code'

import { BAR_CELLS, type LineModel, type LineTone } from './line-model'

const BAR_FULL = '▰'
const BAR_EMPTY = '▱'
// Space between the parts, in the surface's own units (columns on the terminal).
const PART_GAP = 1
// Always there and of one width, so the bar never moves: the labels are as long as each other
// (Nerd Font play and stop). Where keep-warm can never ping it is drawn dim and a press does
// nothing: the mod API's Button has no `disabled`.
const START_LABEL = '󰐊 Warm'
const STOP_LABEL = '󰓛 Stop'
const BUTTON_WIDTH = 10
// The aby panel's hues: its green and amber; grey is the dim default.
const TONE_COLORS: Record<LineTone, string | undefined> = { green: '#5fd700', amber: '#d7af00', grey: undefined }

export type LineComponents = ReturnType<EngineInterface['ui']['resolve']>

// Aligned right, like the aby panel's facts: each detail followed by `·`, the time left and
// the bar last, so the bar keeps its place while the text before it changes length. Each part is
// its own element and the spacing comes from the layout (column gaps), which no surface squeezes
// the way it squeezes runs of spaces inside one text. In a narrow window nothing wraps: the time,
// the bar and the button keep their size and the details are cut.
export function drawLine({ Box, Button, Text }: LineComponents, model: LineModel, onToggle: () => void) {
  const color = TONE_COLORS[model.tone]
  const dim = (text: string) => <Box flexShrink={0}><Text dimColor>{text}</Text></Box>
  return (
    <Box alignItems="center" justifyContent="flex-end" flexWrap="nowrap" columnGap={PART_GAP}>
      <Box flexShrink={1} minWidth={0} overflow="hidden" flexWrap="nowrap" alignItems="center" columnGap={PART_GAP}>
        {model.details.flatMap(detail => [dim(detail), dim('·')])}
      </Box>
      <Box flexShrink={0}><Text bold>{model.main}</Text></Box>
      <Box flexShrink={0}>
        {color ? <Text color={color}>{BAR_FULL.repeat(model.filledCells)}</Text> : <Text dimColor>{BAR_FULL.repeat(model.filledCells)}</Text>}
        <Text dimColor>{BAR_EMPTY.repeat(BAR_CELLS - model.filledCells)}</Text>
      </Box>
      <Box flexShrink={0} width={BUTTON_WIDTH} marginLeft={1}>
        {model.canToggle
          ? <Button key="toggle" label={model.isOn ? STOP_LABEL : START_LABEL} onPress={onToggle} />
          : <Button key="toggle" label={START_LABEL} dimColor onPress={() => {}} />}
      </Box>
    </Box>
  )
}
