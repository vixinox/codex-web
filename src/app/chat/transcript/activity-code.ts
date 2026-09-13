export function detectShellLanguage(command: string): 'powershell' | 'bash' {
  const powershell =
    /\$env:/i.test(command) ||
    /\b(?:Add|Clear|ConvertFrom|ConvertTo|Copy|Export|ForEach|Get|Import|Invoke|Move|New|Out|Remove|Rename|Resolve|Select|Set|Start|Stop|Test|Update|Where|Write)-[A-Z][\w-]*\b/.test(
      command,
    ) ||
    /\|\s*(?:ForEach-Object|Select-Object|Where-Object)\b/i.test(command)
  return powershell ? 'powershell' : 'bash'
}

/**
 * Command output routinely arrives with blank edge lines: PowerShell wraps
 * `-Command` stdout in leading/trailing newlines, and CRLF output ends each
 * line with a stray carriage return. Blank lines inside the payload are
 * meaningful, so only the edges are trimmed.
 */
export function trimBlankEdgeLines(output: string) {
  const lines = output.replace(/\r\n?/g, '\n').split('\n')
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end).join('\n')
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
