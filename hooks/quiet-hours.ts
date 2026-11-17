// Quiet hours: the local times of day keep-warm sends no ping without a stop time, read from the
// plugin's options into a value. Pure: the options come in from register.tsx.
export type QuietOff = { kind: 'off' }
// Minutes since local midnight; the range runs across midnight when the start is later.
export type QuietOn = { kind: 'on', startMin: number, endMin: number }
// A setting that could not be read: no ping until it is fixed, never a silent fallback.
export type QuietInvalid = { kind: 'invalid', setting: 'switch' | 'range', text: string }
export type QuietHours = QuietOff | QuietOn | QuietInvalid

const DEFAULT_RANGE = '21:30-08:00'
// H:MM or HH:MM, hours 0–23 and minutes 0–59, twice, with spaces allowed around the dash.
const CLOCK = '([01]?\\d|2[0-3]):([0-5]\\d)'
const RANGE = new RegExp(`^\\s*${CLOCK}\\s*-\\s*${CLOCK}\\s*$`)
const HOUR_MIN = 60

// The `quiet_hours` switch and the `quiet_range` text as they come from the plugin's options.
export function parseQuietHours(isOn: unknown, range: unknown): QuietHours {
  if (isOn === false) return { kind: 'off' }
  if (isOn !== undefined && isOn !== true) return { kind: 'invalid', setting: 'switch', text: String(isOn) }
  return parseRange(range ?? DEFAULT_RANGE)
}

function parseRange(range: unknown): QuietHours {
  const invalid: QuietInvalid = { kind: 'invalid', setting: 'range', text: String(range) }
  const match = typeof range === 'string' ? RANGE.exec(range) : undefined
  if (!match) return invalid
  const startMin = minuteOfDay(match[1], match[2])
  const endMin = minuteOfDay(match[3], match[4])
  if (startMin === endMin) return invalid
  return { kind: 'on', startMin, endMin }
}

// Minutes since midnight; RANGE has already checked the hour and the minute.
function minuteOfDay(hours: string, mins: string) {
  return Number(hours) * HOUR_MIN + Number(mins)
}
