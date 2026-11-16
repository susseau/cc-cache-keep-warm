// The line's bar: blocks that empty over the cache's life, the one gauge of the time left;
// filled blocks in the line's tone, outlined blocks for the time already gone.
export const BAR_CELLS = 6

export type BarTime = { isWarm: boolean, remaining: number, ttlMs: number }

// At least one block while the cache is warm, none once it is cold.
export function filledCells({ isWarm, remaining, ttlMs }: BarTime) {
  return isWarm ? Math.max(1, Math.ceil((remaining / ttlMs) * BAR_CELLS)) : 0
}
