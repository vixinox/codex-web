export function formatDuration(value: number) {
  const total = Math.max(0, Math.round(value / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return minutes ? `${minutes}m${seconds}s` : `${seconds}s`
}
