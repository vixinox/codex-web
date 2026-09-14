import { describe, expect, it } from 'vitest'
import { toChatTurnPresentation } from './thread-presentation'

describe('thread user input projection', () => {
  it('projects native skills and removes only the bridge-injected marker prefix', () => {
    const turn = toChatTurnPresentation(
      {
        id: 'turn-1',
        status: 'completed',
        items: [
          {
            id: 'user-1',
            type: 'userMessage',
            content: [
              { type: 'text', text: '$skill-creator $pdf\nCreate a release checklist.' },
              { type: 'skill', name: 'skill-creator', path: 'C:/private/skill.md' },
              { type: 'skill', name: 'pdf', path: 'C:/private/pdf.md' },
            ],
          },
        ],
      },
      0,
      [],
    )

    expect(turn.blocks).toEqual([
      {
        id: 'user-1',
        type: 'user',
        content: [
          { type: 'text', text: 'Create a release checklist.' },
          { type: 'reference', kind: 'skill', label: 'skill-creator' },
          { type: 'reference', kind: 'skill', label: 'pdf' },
        ],
      },
    ])
  })

  it('keeps manually entered skill markers when no native skill reference is present', () => {
    const turn = toChatTurnPresentation(
      {
        id: 'turn-1',
        status: 'completed',
        items: [
          {
            id: 'user-1',
            type: 'userMessage',
            content: [{ type: 'text', text: '$skill-creator Create a release checklist.' }],
          },
        ],
      },
      0,
      [],
    )

    expect(turn.blocks[0]).toMatchObject({
      content: [{ type: 'text', text: '$skill-creator Create a release checklist.' }],
    })
  })

  it('projects every safe historical item into readable blocks', () => {
    const turn = toChatTurnPresentation(
      {
        id: 'turn-1',
        status: 'completed',
        items: [
          { id: 'reasoning', type: 'reasoning', summary: ['Checked the project.'] },
          {
            id: 'search',
            type: 'webSearch',
            query: 'Codex App Server',
            action: { type: 'search' },
          },
          {
            id: 'tool',
            type: 'mcpToolCall',
            server: 'docs',
            tool: 'read',
            status: 'completed',
            result: 'Found it.',
          },
          {
            id: 'dynamic',
            type: 'dynamicToolCall',
            tool: 'lookup',
            status: 'completed',
            result: 'Value',
          },
          {
            id: 'agent',
            type: 'collabAgentToolCall',
            tool: 'spawn_agent',
            status: 'completed',
            agentCount: 2,
          },
          { id: 'subagent', type: 'subAgentActivity', kind: 'working' },
          { id: 'image', type: 'imageView' },
          { id: 'sleep', type: 'sleep', durationMs: 500 },
          { id: 'review', type: 'enteredReviewMode', review: 'Review' },
          { id: 'generation', type: 'imageGeneration', status: 'completed', result: 'Generated.' },
          { id: 'future', type: 'futureItem' },
        ],
      },
      0,
      [],
    )
    const activities = turn.blocks.flatMap((block) =>
      block.type === 'activity' ? block.activities : [],
    )
    expect(activities).toHaveLength(11)
    expect(activities.find((activity) => activity.id === 'reasoning')).toMatchObject({
      kind: 'reasoning',
      detail: 'Checked the project.',
    })
    expect(activities.find((activity) => activity.id === 'tool')).toMatchObject({
      kind: 'tool',
      title: 'read',
      detail: 'Found it.',
      meta: 'docs',
    })
  })

  it('migrates discriminated Web Search actions into the UI model', () => {
    const turn = toChatTurnPresentation(
      {
        id: 'turn-1',
        status: 'completed',
        items: [
          {
            id: 'open',
            type: 'webSearch',
            action: { type: 'openPage', url: 'https://example.com/docs' },
          },
          {
            id: 'find',
            type: 'webSearch',
            action: {
              type: 'findInPage',
              url: 'https://example.com/docs',
              pattern: 'installation',
            },
          },
          {
            id: 'search',
            type: 'webSearch',
            action: { type: 'search', query: 'Codex', queries: ['Codex docs'] },
          },
        ],
      },
      0,
      [],
    )
    const activities = turn.blocks.flatMap((block) =>
      block.type === 'activity' ? block.activities : [],
    )
    expect(activities).toMatchObject([
      {
        id: 'open',
        title: 'Opened page',
        searchAction: { type: 'openPage', url: 'https://example.com/docs' },
      },
      {
        id: 'find',
        title: 'Found in page',
        searchAction: {
          type: 'findInPage',
          url: 'https://example.com/docs',
          pattern: 'installation',
        },
      },
      {
        id: 'search',
        title: 'Searched the web',
        searchAction: { type: 'search', query: 'Codex', queries: ['Codex docs'] },
      },
    ])
  })

  it('keeps a final-answer phase streaming while its turn is in progress', () => {
    const turn = toChatTurnPresentation(
      {
        id: 'turn-1',
        status: 'inProgress',
        items: [
          { id: 'answer', type: 'agentMessage', text: 'Still streaming.', phase: 'final_answer' },
        ],
      },
      0,
      [],
    )

    expect(turn.blocks).toEqual([
      { id: 'answer', type: 'assistant', text: 'Still streaming.', final: true },
    ])
  })

  it('projects a final-answer phase as a stable final assistant block after the turn is terminal', () => {
    const turn = toChatTurnPresentation(
      {
        id: 'turn-1',
        status: 'completed',
        items: [{ id: 'answer', type: 'agentMessage', text: 'Done.', phase: 'final_answer' }],
      },
      0,
      [],
    )

    expect(turn.blocks).toEqual([{ id: 'answer', type: 'assistant', text: 'Done.', final: true }])
  })
})
