param(
  [ValidateSet('elevated', 'unelevated')]
  [string]$Mode = 'elevated'
)

$projectRoot = $PSScriptRoot
$codexHome = Join-Path $projectRoot '.data\codex\guest\.codex'
$configPath = Join-Path $codexHome 'config.toml'
$config = "[windows]`nsandbox = `"$Mode`"`n"

New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($configPath, $config, $utf8WithoutBom)

Write-Host "Guest Windows sandbox configured: $Mode"
Write-Host "Config: $configPath"
Write-Host 'Press any key to exit...'
[Console]::ReadKey($true) | Out-Null