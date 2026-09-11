import { describe, expect, it } from 'vitest'

import { detectShellLanguage, formatDisplayedCommand } from './activity-code'

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
