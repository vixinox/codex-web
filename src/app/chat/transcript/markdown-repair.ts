/** Close a Markdown fenced block when a turn ended before its closing fence arrived. */
export function repairInterruptedCodeFence(text: string) {
  const lines = text.split(/\r?\n/)
  let openFence: { marker: '`' | '~'; length: number } | undefined

  for (const line of lines) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (!match) continue
    const marker = match[2][0] as '`' | '~'
    const length = match[2].length
    const suffix = match[3]

    if (!openFence) {
      if (marker === '`' && suffix.includes('`')) continue
      openFence = { marker, length }
      continue
    }

    if (marker === openFence.marker && length >= openFence.length && !suffix.trim()) {
      openFence = undefined
    }
  }

  if (!openFence) return text
  return `${text.replace(/[ \t]+$/, '')}\n${openFence.marker.repeat(openFence.length)}`
}
