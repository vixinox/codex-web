import { createBundledHighlighter, createSingletonShorthands } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import type { ThemeVariant } from '@/lib/theme/theme'
import { vscode2026Dark, vscode2026Light } from './code-themes'

const MAX_HIGHLIGHTED_CODE_LENGTH = 100_000

const languageAliases: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  console: 'text',
  diff: 'diff',
  env: 'text',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  log: 'text',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  powershell: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  plaintext: 'text',
  python: 'python',
  sh: 'bash',
  shell: 'bash',
  text: 'text',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  txt: 'text',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

const createHighlighter = createBundledHighlighter({
  engine: () => createJavaScriptRegexEngine(),
  langs: {
    bash: () => import('@shikijs/langs/bash'),
    diff: () => import('@shikijs/langs/diff'),
    javascript: () => import('@shikijs/langs/javascript'),
    jsx: () => import('@shikijs/langs/jsx'),
    json: () => import('@shikijs/langs/json'),
    markdown: () => import('@shikijs/langs/markdown'),
    powershell: () => import('@shikijs/langs/powershell'),
    python: () => import('@shikijs/langs/python'),
    tsx: () => import('@shikijs/langs/tsx'),
    typescript: () => import('@shikijs/langs/typescript'),
    yaml: () => import('@shikijs/langs/yaml'),
  },
  themes: {
    vscode2026Dark: () => vscode2026Dark,
    vscode2026Light: () => vscode2026Light,
  },
})

const { codeToHtml } = createSingletonShorthands(createHighlighter)

export function normalizeLanguage(language: string) {
  return languageAliases[language.toLowerCase()] ?? 'text'
}

export async function highlightCode(code: string, language: string, variant: ThemeVariant) {
  const normalizedLanguage = normalizeLanguage(language)
  if (normalizedLanguage === 'text' || code.length > MAX_HIGHLIGHTED_CODE_LENGTH) return undefined

  return codeToHtml(code, {
    lang: normalizedLanguage,
    rootStyle: false,
    theme: variant === 'light' ? 'vscode2026Light' : 'vscode2026Dark',
  })
}
