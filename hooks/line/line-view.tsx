// The line above the prompt, drawn from a ready LineModel.
import type { EngineInterface } from 'claude-code'

import { BAR_CELLS, type LineModel, type LineTone } from './line-model'

const BAR_FULL = '•'
const BAR_EMPTY = '·'
// Space between the parts, in the surface's own units (columns on the terminal).
const PART_GAP = 1
// Always there and of one width, so the bar never moves: the labels are as long as each other
// (Nerd Font play and stop). Where keep-warm can never ping it is drawn dim and a press does
// nothing: the mod API's Button has no `disabled`.
const START_LABEL = '󰐊 Warm'
const STOP_LABEL = '󰓛 Stop'
// A plain Button holding an inverse Text: on the terminal a solid block instead of `[ label ]`
// (owner's choice); a desktop draws its native button either way. The padding is part of the
// block: 6 columns of label (the icon is one column, two UTF-16 units) and one each side.
const BUTTON_PADDING = ' '
const BUTTON_WIDTH = 8
// Muted on purpose (owner's choice): steel blue and mustard; off is the dim default.
const TONE_COLORS: Record<LineTone, string | undefined> = { keeping: '#5f87af', stalled: '#b5a55f', off: undefined }
// The Warm button while keep-warm is off: a muted rust that invites a press without shouting,
// apart from the mustard of `stalled` so the two never look alike (owner's choice, ckw-tm6).
const WARM_BUTTON_COLOR = '#a9714f'

export type LineComponents = ReturnType<EngineInterface['ui']['resolve']>

// Aligned right, like the aby panel's facts: each detail followed by `·`, the time left and
// the bar last, so the bar keeps its place while the text before it changes length. Each part is
// its own element and the spacing comes from the layout (column gaps), which no surface squeezes
// the way it squeezes runs of spaces inside one text. In a narrow window nothing wraps: the time,
// the bar and the button keep their size and the details are cut.
export function drawLine(components: LineComponents, model: LineModel, onToggle: () => void) {
  const { Box, Text } = components
  const color = TONE_COLORS[model.tone]
  const dim = (text: string) => <Box flexShrink={0}><Text dimColor>{text}</Text></Box>
  return (
    <Box alignItems="center" justifyContent="flex-end" flexWrap="nowrap" columnGap={PART_GAP}>
      <Box flexShrink={1} minWidth={0} overflow="hidden" flexWrap="nowrap" alignItems="center" columnGap={PART_GAP}>
        {model.details.flatMap(detail => [dim(detail), dim('·')])}
      </Box>
      <Box flexShrink={0}><Text>{model.main}</Text></Box>
      <Box flexShrink={0}>
        {color ? <Text color={color}>{BAR_FULL.repeat(model.filledCells)}</Text> : <Text dimColor>{BAR_FULL.repeat(model.filledCells)}</Text>}
        <Text dimColor>{BAR_EMPTY.repeat(BAR_CELLS - model.filledCells)}</Text>
      </Box>
      <Box flexShrink={0} width={BUTTON_WIDTH}>
        {model.canToggle
          ? toggleButton(components, { label: model.isOn ? STOP_LABEL : START_LABEL, color: color ?? WARM_BUTTON_COLOR }, onToggle)
          : toggleButton(components, { label: START_LABEL })}
      </Box>
    </Box>
  )
}

// In the bar's colour while keep-warm is on, in muted rust while it is off (the bar is grey then);
// dim only on the inert button, which has no `onPress`: a press does nothing.
function toggleButton({ Button, Text }: LineComponents, { label, color }: { label: string, color?: string }, onPress?: () => void) {
  const isDim = !color || !onPress
  return (
    <Button key="toggle" label={label} plain dimColor={isDim} onPress={onPress ?? (() => {})}>
      <Text inverse color={color} dimColor={isDim}>{BUTTON_PADDING}{label}{BUTTON_PADDING}</Text>
    </Button>
  )
}
