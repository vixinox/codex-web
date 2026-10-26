import type { ComposerSkill } from '@/app/chat/model/composer-types'
import { getOwnerBridge } from '../owner-runtime'

export async function fetchSkills(
  projectId: string | null,
  signal?: AbortSignal,
): Promise<readonly ComposerSkill[]> {
  const value = await getOwnerBridge().request('skills.list', { projectId }, { signal })
  return Array.isArray(value) ? (value as ComposerSkill[]) : []
}
