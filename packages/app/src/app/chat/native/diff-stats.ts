export type DiffStats = { files: number; additions: number; deletions: number }
export type DiffLineStats = Pick<DiffStats, 'additions' | 'deletions'>

export function countDiffStats(
  diff: string | undefined,
  changes: readonly { path: string; movePath?: string; diff?: string }[] = [],
): DiffStats {
  const paths = new Set<string>()
  const movedTo = new Set<string>()
  let additions = 0
  let deletions = 0

  for (const change of changes) {
    paths.add(change.path)
    if (change.movePath) movedTo.add(change.movePath)
  }

  if (diff) {
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ ') || line.startsWith('--- ')) {
        const path = line.slice(4).trim().replace(/^a\//, '').replace(/^b\//, '')
        if (path && path !== '/dev/null' && !movedTo.has(path)) paths.add(path)
      }
    }
    const counts = countDiffLines(diff)
    additions = counts.additions
    deletions = counts.deletions
  }

  if (additions === 0 && deletions === 0) {
    for (const change of changes) {
      if (!change.diff) continue
      const counts = countDiffLines(change.diff)
      additions += counts.additions
      deletions += counts.deletions
    }
  }

  return { files: paths.size, additions, deletions }
}

export function countDiffLines(diff: string | undefined): DiffLineStats {
  if (!diff) return { additions: 0, deletions: 0 }
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}
