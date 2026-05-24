export const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

export const colorForOffset = (offsetMs: number, yRangeMs: number): string => {
  const amount = Math.min(Math.abs(offsetMs) / yRangeMs, 1)
  const start = { r: 92, g: 230, b: 152 }
  const end = offsetMs >= 0 ? { r: 255, g: 108, b: 92 } : { r: 92, g: 170, b: 255 }
  const r = Math.round(start.r + (end.r - start.r) * amount)
  const g = Math.round(start.g + (end.g - start.g) * amount)
  const b = Math.round(start.b + (end.b - start.b) * amount)
  return `rgb(${r}, ${g}, ${b})`
}
