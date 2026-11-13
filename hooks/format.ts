import { HOUR_MS, MINUTE_MS } from './cache-timing'

export function minutes(ms: number) {
  return Math.max(0, Math.floor(ms / MINUTE_MS))
}

export function clockTime(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function tokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

export function timeLeft(ms: number) {
  return ms < MINUTE_MS ? 'under a minute left' : `${minutes(ms)} min left`
}

export function cacheLength(ms: number) {
  return ms >= HOUR_MS && ms % HOUR_MS === 0 ? `${ms / HOUR_MS}-hour` : `${minutes(ms)}-minute`
}
