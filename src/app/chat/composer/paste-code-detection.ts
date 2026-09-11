import { unwrapSingleFencedCode } from './chat-input-markdown'

const MAX_DETECTION_SAMPLE = 64 * 1024

export type ClipboardCodeEvidence = {
  text: string
  html?: string
  vscodeEditorData?: string
  vscodeCopyMetadata?: string
}

export type CodePasteDetection = {
  codeLike: boolean
  text: string
  reason: 'fence' | 'editor-language' | 'editor-html' | 'json' | 'shebang' | 'heuristic' | 'plain'
}

export function countLogicalLines(text: string) {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return Math.max(1, lines.length)
}

function detectionSample(text: string) {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (normalized.length <= MAX_DETECTION_SAMPLE) return normalized
  const half = MAX_DETECTION_SAMPLE / 2
  return `${normalized.slice(0, half)}\n${normalized.slice(-half)}`
}

function hasEditorLanguage(raw: string | undefined) {
  if (!raw) return false
  try {
    const value = JSON.parse(raw) as { version?: unknown; mode?: unknown }
    return (
      value.version === 1 &&
      typeof value.mode === 'string' &&
      value.mode.length > 0 &&
      value.mode.toLowerCase() !== 'plaintext'
    )
  } catch {
    return false
  }
}

function hasEditorHtmlFingerprint(html: string | undefined) {
  if (!html || html.length > 256 * 1024 || typeof DOMParser === 'undefined') return false
  const document = new DOMParser().parseFromString(html, 'text/html')
  const preformatted = Array.from(
    document.body.querySelectorAll<HTMLElement>('div, pre, code'),
  ).some((element) => element.style.whiteSpace === 'pre' || element.tagName === 'PRE')
  const lineCount = document.body.querySelectorAll('div > div').length
  const styledTokens = Array.from(
    document.body.querySelectorAll<HTMLElement>('span[style]'),
  ).filter((element) =>
    Boolean(element.style.color || element.style.fontStyle || element.style.fontWeight),
  ).length
  return preformatted && lineCount >= 2 && styledTokens >= 2
}

function isJsonContainer(text: string) {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    const value = JSON.parse(trimmed)
    return value !== null && typeof value === 'object'
  } catch {
    return false
  }
}

function heuristicScore(sample: string) {
  const lines = sample.split('\n')
  const nonEmpty = lines.filter((line) => line.trim())
  const categories = new Set<string>()
  let score = 0

  if (
    /^(?:\s*)(?:import|export|function|class|interface|type|enum|def|package|namespace|using)\b/m.test(
      sample,
    )
  ) {
    score += 3
    categories.add('declaration')
  }
  if (
    /<(?:[A-Za-z][\w.-]*)(?:\s[^<>]*)?>[\s\S]*<\//.test(sample) ||
    /<\/?[A-Za-z][^>]*\/>/.test(sample)
  ) {
    score += 3
    categories.add('markup')
  }
  if (
    /\bSELECT\b[\s\S]+\bFROM\b/i.test(sample) ||
    /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|CREATE\s+TABLE)\b/i.test(sample)
  ) {
    score += 3
    categories.add('sql')
  }
  if (/^(?:diff --git|@@\s+-\d|[+-]{3}\s)/m.test(sample)) {
    score += 3
    categories.add('diff')
  }
  if (
    /^(?:\s*at\s+.+\(.+:\d+:\d+\)|Traceback \(most recent call last\):|\w+(?:Error|Exception):)/m.test(
      sample,
    )
  ) {
    score += 3
    categories.add('stack')
  }
  if (
    /^(?:\$|PS [^>]+>|> )\s*\S+/m.test(sample) ||
    /(?:^|\s)(?:npm|pnpm|yarn|git|curl|docker|kubectl)\s+[\w-]+/.test(sample)
  ) {
    score += 3
    categories.add('shell')
  }
  if (/^\s*[A-Z][a-z]+-[A-Z][A-Za-z]+(?:\s+-[A-Za-z]+\s+\S+)+/m.test(sample)) {
    score += 3
    categories.add('powershell')
  }
  if (nonEmpty.filter((line) => /^\s*[\w.-]+\s*(?::|=)\s*\S+/.test(line)).length >= 2) {
    score += 3
    categories.add('config')
  }
  if (/[^{}]+\{\s*(?:[\w-]+\s*:[^;{}]+;\s*)+\}/s.test(sample)) {
    score += 3
    categories.add('stylesheet')
  }
  if (
    nonEmpty.filter((line) =>
      /^(?:\[?\d{4}-\d\d?-\d\d?|\d\d?:\d\d?:\d\d?|\[(?:INFO|WARN|ERROR|DEBUG)\])/.test(line.trim()),
    ).length >= 2
  ) {
    score += 3
    categories.add('log')
  }
  if (nonEmpty.filter((line) => /^\s{2,}\S/.test(line) || /^\t+\S/.test(line)).length >= 2) {
    score += 2
    categories.add('indentation')
  }
  const structuralLines = nonEmpty.filter((line) =>
    /(?:[{};]|=>|===?|!==?|\b(?:if|else|for|while|return|const|let|var)\b)/.test(line),
  ).length
  if (structuralLines >= Math.max(2, Math.ceil(nonEmpty.length * 0.3))) {
    score += 2
    categories.add('syntax')
  }
  if (nonEmpty.filter((line) => /^\s*(?:\/\/|\/\*|\*|#(?!\s)|--\s)/.test(line)).length >= 2) {
    score += 1
    categories.add('comments')
  }
  if (
    nonEmpty.filter(
      (line) => /[。！？]|[.!?]$/.test(line.trim()) && line.trim().split(/\s+/).length >= 6,
    ).length >= Math.max(2, nonEmpty.length * 0.5)
  )
    score -= 4
  if (
    nonEmpty.filter((line) => /^\s*(?:#{1,6}\s|[-*+]\s|>\s|\|.+\|\s*$)/.test(line)).length >=
    Math.max(2, nonEmpty.length * 0.5)
  )
    score -= 3
  if (
    nonEmpty.length <= 2 &&
    nonEmpty.every((line) => /^(?:https?:\/\/|[A-Za-z]:\\|\/)[^\s]+$/.test(line.trim()))
  )
    score -= 3

  return { score, categoryCount: categories.size }
}

export function detectCodePaste(evidence: ClipboardCodeEvidence): CodePasteDetection {
  const fenced = unwrapSingleFencedCode(evidence.text)
  if (fenced !== undefined) return { codeLike: true, text: fenced, reason: 'fence' }
  if (hasEditorLanguage(evidence.vscodeEditorData))
    return { codeLike: true, text: evidence.text, reason: 'editor-language' }
  if (/^#!\s*\/\S+/.test(evidence.text))
    return { codeLike: true, text: evidence.text, reason: 'shebang' }
  if (evidence.text.length <= MAX_DETECTION_SAMPLE && isJsonContainer(evidence.text))
    return { codeLike: true, text: evidence.text, reason: 'json' }

  const singleLine = !/[\r\n]/.test(evidence.text)
  if (
    singleLine &&
    (/^\s*(?:import|export|function|class|interface|def)\b/.test(evidence.text) ||
      /^\s*(?:npm|pnpm|yarn|git|curl|docker|kubectl)\s+\S+(?:\s+\S+)+/.test(evidence.text) ||
      /^\s*[A-Z][a-z]+-[A-Z][A-Za-z]+\s+-[A-Za-z]+\s+\S+/.test(evidence.text))
  )
    return { codeLike: true, text: evidence.text, reason: 'heuristic' }

  const sample = detectionSample(evidence.text)
  const heuristic = heuristicScore(sample)
  if (hasEditorHtmlFingerprint(evidence.html))
    return { codeLike: true, text: evidence.text, reason: 'editor-html' }

  const hasSourceHint = Boolean(evidence.vscodeCopyMetadata)
  const multiline = countLogicalLines(evidence.text) > 1
  const threshold = multiline ? 5 : 6
  const categoryMinimum = multiline ? 2 : 1
  const score = heuristic.score + (hasSourceHint ? 1 : 0)
  if (score >= threshold && heuristic.categoryCount >= categoryMinimum)
    return { codeLike: true, text: evidence.text, reason: 'heuristic' }
  return { codeLike: false, text: evidence.text, reason: 'plain' }
}
