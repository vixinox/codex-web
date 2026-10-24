import { describe, expect, it } from 'vitest'

import { detectShellLanguage, formatDisplayedCommand, trimBlankEdgeLines } from './activity-code'

describe('detectShellLanguage', () => {
  it.each([
    ['Get-ChildItem -Force', 'powershell'],
    ['$env:NODE_ENV = "test"; pnpm test', 'powershell'],
    ['Write-Output $value | Select-Object -First 1', 'powershell'],
    ['pnpm test -- --runInBand', 'bash'],
    ['git status && git diff', 'bash'],
    ['', 'bash'],
  ])('classifies %j as %s', (command, expected) => {
    expect(detectShellLanguage(command)).toBe(expected)
  })
})

describe('formatDisplayedCommand', () => {
  it.each([
    [
      '"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.5.0_x64__8wekyb3d8bbwe\\pwsh.exe" -Command \'Get-ChildItem -Force | Select-Object -First 10 Name,Length,Mode\'',
      'Get-ChildItem -Force | Select-Object -First 10 Name,Length,Mode',
    ],
    ['pwsh -c "Get-Location"', 'Get-Location'],
    ['pnpm typecheck', 'pnpm typecheck'],
  ])('formats %j as %j', (command, expected) => {
    expect(formatDisplayedCommand(command)).toBe(expected)
  })
})

describe('trimBlankEdgeLines', () => {
  it('strips the blank lines PowerShell wraps around command output', () => {
    expect(trimBlankEdgeLines('\r\n2026年9月13日 15:04:19\r\n\r\n\r\n')).toBe(
      '2026年9月13日 15:04:19',
    )
  })

  it('keeps interior blank lines and line indentation', () => {
    expect(trimBlankEdgeLines('\nfirst\n\n  indented\n\n')).toBe('first\n\n  indented')
  })

  it('collapses an all-blank payload to nothing', () => {
    expect(trimBlankEdgeLines('\r\n\r\n')).toBe('')
    expect(trimBlankEdgeLines('')).toBe('')
  })
})
