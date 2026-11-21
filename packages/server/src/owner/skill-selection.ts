import { skillsForCwd, type NativeSkill } from '../skills.js'

export type SkillSelection = Pick<NativeSkill, 'name' | 'path'>

export function parseSkills(value: unknown): SkillSelection[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32) return null
  const selected: SkillSelection[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.name !== 'string' ||
      !item.name ||
      typeof item.path !== 'string' ||
      !item.path
    )
      return null
    const key = JSON.stringify([item.name, item.path])
    if (seen.has(key)) return null
    seen.add(key)
    selected.push({ name: item.name, path: item.path })
  }
  return selected
}

export async function resolveSelectedSkills(
  client: { request(method: string, params?: Record<string, unknown>): Promise<unknown> },
  cwd: string,
  selected: readonly SkillSelection[],
): Promise<NativeSkill[] | null> {
  if (selected.length === 0) return []
  const available = skillsForCwd(
    await client.request('skills/list', { cwds: [cwd], forceReload: true }),
    cwd,
  )
  const result: NativeSkill[] = []
  for (const skill of selected) {
    const match = available.find(
      (candidate) => candidate.name === skill.name && candidate.path === skill.path,
    )
    if (!match) return null
    result.push(match)
  }
  return result
}
