import { describe, expect, it } from 'vitest'

import { countDiffLines, countDiffStats } from './diff-stats'

describe('countDiffStats', () => {
  it('counts files and content lines without counting file headers', () => {
    expect(countDiffStats('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n context')).toEqual({
      files: 1,
      additions: 1,
      deletions: 1,
    })
  })

  it('uses file changes when no diff is available and deduplicates updates', () => {
    expect(
      countDiffStats(undefined, [
        { path: 'a.ts' },
        { path: 'a.ts' },
        { path: 'b.ts', diff: '+new\n-old' },
      ]),
    ).toEqual({ files: 2, additions: 1, deletions: 1 })
  })

  it('counts a move as one logical file', () => {
    expect(countDiffStats(undefined, [{ path: 'before.ts', movePath: 'after.ts' }])).toEqual({
      files: 1,
      additions: 0,
      deletions: 0,
    })
  })

  it('counts one diff without treating file headers as content', () => {
    expect(countDiffLines('--- a/a.ts\n+++ b/a.ts\n-old\n+new\n+another\n unchanged')).toEqual({
      additions: 2,
      deletions: 1,
    })
  })

  it('returns no line changes when a file has no diff yet', () => {
    expect(countDiffLines(undefined)).toEqual({ additions: 0, deletions: 0 })
  })
})
