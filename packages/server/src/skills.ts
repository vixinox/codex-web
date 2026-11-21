import path from 'node:path'

export type NativeSkill = {
  name: string
  description: string
  path: string
  scope: 'user' | 'repo' | 'system' | 'admin'
  enabled: boolean
  interface: {
    displayName: string | null
    shortDescription: string | null
  } | null
  shortDescription: string | null
}

export type SkillSummary = {
  path: string
  name: string
  displayName: string
  description: string
  scope: NativeSkill['scope']
}

export function summarizeSkill(skill: NativeSkill): SkillSummary {
  return {
    path: skill.path,
    name: skill.name,
    displayName: skill.interface?.displayName ?? skill.name,
    description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
    scope: skill.scope,
  }
}

export function skillsForCwd(value: unknown, cwd: string): NativeSkill[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return []
  const entry = value.data.find((candidate) => isRecord(candidate) && candidate.cwd === cwd)
  if (!entry || !Array.isArray(entry.skills)) return []
  return entry.skills.flatMap((candidate: unknown) => {
    const skill = toNativeSkill(candidate)
    return skill?.enabled ? [skill] : []
  })
}

export function turnInput(text: string, skills: readonly NativeSkill[]) {
  if (skills.length === 0) return [{ type: 'text', text }]
  return [
    { type: 'text', text: `${skills.map((skill) => `$${skill.name}`).join(' ')}\n${text}` },
    ...skills.map((skill) => ({ type: 'skill', name: skill.name, path: skill.path })),
  ]
}

function toNativeSkill(value: unknown): NativeSkill | null {
  if (!isRecord(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  const skillPath = typeof value.path === 'string' ? value.path : ''
  const scope = value.scope
  const enabled = value.enabled === true
  if (
    !name ||
    !skillPath ||
    !path.isAbsolute(skillPath) ||
    !['user', 'repo', 'system', 'admin'].includes(String(scope))
  )
    return null
  const interfaceValue = isRecord(value.interface)
    ? {
        displayName:
          typeof value.interface.displayName === 'string'
            ? value.interface.displayName.trim() || null
            : null,
        shortDescription:
          typeof value.interface.shortDescription === 'string'
            ? value.interface.shortDescription.trim() || null
            : null,
      }
    : null
  return {
    name,
    description,
    path: skillPath,
    scope: scope as NativeSkill['scope'],
    enabled,
    interface: interfaceValue,
    shortDescription:
      typeof value.shortDescription === 'string' ? value.shortDescription.trim() || null : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
