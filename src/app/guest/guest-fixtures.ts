import type { ComposerSkill } from '@/app/chat/model/composer-types'
import type { ChatThreadPresentation } from '@/app/chat/model/types'

/**
 * Guest Workspace deliberately renders only this deterministic, browser-local
 * data. It is never derived from owner threads, skills, projects, or files.
 */
export const GUEST_FIXTURE_SKILLS: readonly ComposerSkill[] = [
  {
    handle: 'guest-fixture:product-brief',
    name: 'product-brief',
    displayName: 'Product Brief Review',
    description: 'Review the isolated product-brief fixture.',
    scope: 'system',
  },
  {
    handle: 'guest-fixture:data-summary',
    name: 'data-summary',
    displayName: 'Data Summary',
    description: 'Summarize the isolated CSV fixture.',
    scope: 'system',
  },
  {
    handle: 'guest-fixture:research-outline',
    name: 'research-outline',
    displayName: 'Research Outline',
    description: 'Structure a research plan without making a network request.',
    scope: 'system',
  },
]

export const GUEST_FIXTURE_CAPACITY = {
  globalDailyTokenLimit: 1_000_000,
  globalDailyTokenUsed: 184_200,
  perGuestDailyTokenLimit: 128_000,
  perGuestDailyTokenUsed: 4_816,
  maxActiveThreads: 5,
  activeThreads: 1,
  queuedTurns: 0,
  contextWindow: 16_000,
} as const

export function freshGuestFixtureThreads(): ChatThreadPresentation[] {
  return []
}
