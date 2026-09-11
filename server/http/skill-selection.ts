import { type SkillHandleStore,matchingSkills,skillsForCwd,type NativeSkill} from '../skills.js';
const MAX_SKILL_HANDLES = 32
export function parseSkillHandles(value: unknown): string[] | null {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.length > MAX_SKILL_HANDLES ||
    !value.every((handle) => typeof handle === 'string' && /^[0-9a-f-]{36}$/i.test(handle))
  )
    return null
  const handles = value as string[]
  return new Set(handles).size === handles.length ? handles : null
}
export async function resolveSelectedSkills(
  client: { request(method: string, params?: Record<string, unknown>): Promise<unknown> },
  skillHandles: SkillHandleStore,
  userId: string,
  cwd: string,
  handles: readonly string[],
): Promise<NativeSkill[] | null> {
  if (handles.length === 0) return []
  const selected = skillHandles.resolve(userId, cwd, handles)
  if (!selected) return null
  const refreshed = skillsForCwd(
    await client.request('skills/list', { cwds: [cwd], forceReload: true }),
    cwd,
  )
  return matchingSkills(selected, refreshed) ? selected : null
}
