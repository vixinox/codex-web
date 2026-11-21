import { describe, expect, it } from 'vitest'
import { createThreadSession } from '@/app/chat/session/state/thread-session-store'
import { applyScenarioStep, nextDelay } from './replay'
import { scenarios } from './scenarios'

describe('UI scenario replay', () => {
  it('replays each synthetic scenario through the production session and resets without retained state', () => {
    for (const scenario of scenarios) {
      const session = createThreadSession(scenario.id, null)
      if (!scenario.loading) session.replaceConversation(scenario.initial)
      for (const step of scenario.steps) applyScenarioStep(session, step)
      expect(session.state.status).toBe(scenario.loading ? 'error' : 'ready')
      session.replaceConversation(scenario.initial)
      expect(session.getConversation()?.watermark).toBe(0)
      expect(session.getConversation()?.interactions).toEqual({})
      session.dispose()
      const after = session.getSnapshot()
      session.replaceConversation(scenario.initial)
      expect(session.getSnapshot()).toBe(after)
    }
  })
  it('uses relative step delays and stops at the end', () => {
    const steps = scenarios[0].steps
    expect(nextDelay(steps, 0)).toBe(800)
    expect(nextDelay(steps, 1)).toBe(800)
    expect(nextDelay(steps, steps.length)).toBeNull()
  })
})
