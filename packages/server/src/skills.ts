import { randomUUID } from 'node:crypto'
import path from 'node:path'

const HANDLE_TTL_MS = 5 * 60 * 1000
const MAX_HANDLES = 2_000

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
  handle: string
  name: string
  displayName: string
  description: string
  scope: NativeSkill['scope']
}

type IssuedSkill = {
  userId: string
  cwd: string
  skill: NativeSkill
  expiresAt: number
}

export class SkillHandleStore {
  private readonly handles = new Map<string, IssuedSkill>()

  issue(userId: string, cwd: string, skill: NativeSkill): SkillSummary {
    this.prune()
    const handle = randomUUID()
    this.handles.set(handle, { userId, cwd, skill, expiresAt: Date.now() + HANDLE_TTL_MS })
    this.prune()
    return {
      handle,
      name: skill.name,
      displayName: skill.interface?.displayName ?? skill.name,
      description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
      scope: skill.scope,
    }
  }

  resolve(userId: string, cwd: string, handles: readonly string[]): NativeSkill[] | null {
    this.prune()
    const selected: NativeSkill[] = []
    for (const handle of handles) {
      const issued = this.handles.get(handle)
      if (!issued || issued.userId !== userId || issued.cwd !== cwd) return null
      selected.push(issued.skill)
    }
    return selected
  }

  private prune() {
    const now = Date.now()
    for (const [handle, value] of this.handles) {
      if (value.expiresAt <= now || this.handles.size > MAX_HANDLES) this.handles.delete(handle)
    }
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

export function matchingSkills(
  selected: readonly NativeSkill[],
  available: readonly NativeSkill[],
) {
  return selected.every((skill) =>
    available.some((candidate) => candidate.name === skill.name && candidate.path === skill.path),
  )
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
