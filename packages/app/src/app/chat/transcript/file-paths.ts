export function shortestUniquePathSuffixes(paths: readonly string[]) {
  const entries = [...new Set(paths)].map((path) => ({
    path,
    segments: splitPath(path),
    depth: 1,
  }))
  let canDisambiguate = true

  while (canDisambiguate) {
    const collisions = new Map<string, typeof entries>()
    for (const entry of entries) {
      const label = pathSuffix(entry.segments, entry.depth, entry.path)
      collisions.set(label, [...(collisions.get(label) ?? []), entry])
    }
    const collidingEntries = [...collisions.values()].filter((group) => group.length > 1).flat()
    const expandable = collidingEntries.filter((entry) => entry.depth < entry.segments.length)
    if (!expandable.length) break
    for (const entry of expandable) entry.depth += 1
    canDisambiguate = expandable.length > 0
  }

  return new Map(
    entries.map((entry) => [entry.path, pathSuffix(entry.segments, entry.depth, entry.path)]),
  )
}

export function fileName(path: string) {
  return pathSuffix(splitPath(path), 1, path)
}

export function redactAbsoluteDiffHeaderPaths(diff: string) {
  return diff.replace(/^(---|\+\+\+)\s+([^\t\r\n]+)(\t.*)?$/gm, (_match, prefix, path, suffix) => {
    const trimmedPath = path.trim()
    const withoutDiffPrefix = trimmedPath.replace(/^[ab][\\/]/, '')
    if (!isAbsolutePath(withoutDiffPrefix) || withoutDiffPrefix === '/dev/null') return _match
    return `${prefix} ${fileName(withoutDiffPrefix)}${suffix ?? ''}`
  })
}

function splitPath(path: string) {
  return path.split(/[\\/]+/).filter(Boolean)
}

function pathSuffix(segments: readonly string[], depth: number, fallback: string) {
  return segments.slice(-depth).join('/') || fallback
}

function isAbsolutePath(path: string) {
  return /^[A-Za-z]:[\\/]|^\\\\|^\//.test(path)
}
