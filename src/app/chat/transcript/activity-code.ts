export function detectShellLanguage(command: string): 'powershell' | 'bash' {
  const powershell =
    /\$env:/i.test(command) ||
    /\b(?:Add|Clear|ConvertFrom|ConvertTo|Copy|Export|ForEach|Get|Import|Invoke|Move|New|Out|Remove|Rename|Resolve|Select|Set|Start|Stop|Test|Update|Where|Write)-[A-Z][\w-]*\b/.test(
      command,
    ) ||
    /\|\s*(?:ForEach-Object|Select-Object|Where-Object)\b/i.test(command)
  return powershell ? 'powershell' : 'bash'
}

export function formatDisplayedCommand(command: string) {
  const match = command.match(
    /^\s*["']?(?:[A-Za-z]:)?[^\r\n]*?\b(?:pwsh|powershell)(?:\.exe)?["']?\s+(?:-NoLogo\s+)?-(?:Command|c)\s+(.+)\s*$/i,
  )
  if (!match) return command
  const script = match[1].trim()
  if (script.length >= 2) {
    const quote = script[0]
    if ((quote === "'" || quote === '"') && script.at(-1) === quote)
      return script.slice(1, -1).trim()
  }
  return script
}
