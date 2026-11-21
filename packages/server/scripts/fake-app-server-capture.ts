import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
let threadId = 'thread_capture'
let turnIndex = 0
const reply = (message: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify(message)}\n`)

lines.on('line', (line) => {
  const message = JSON.parse(line) as Record<string, unknown>
  const id = message.id
  if (message.method === 'initialize') {
    reply({ id, result: { userAgent: 'fake-app-server/0.0.1' } })
  } else if (message.method === 'account/login/start') {
    reply({ id, result: { type: 'apiKey' } })
  } else if (message.method === 'account/read') {
    reply({ id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } })
  } else if (message.method === 'thread/start') {
    reply({ id, result: { thread: { id: threadId } } })
  } else if (message.method === 'turn/start') {
    turnIndex += 1
    const turnId = `turn_${turnIndex}`
    reply({ id, result: { turn: { id: turnId } } })
    reply({
      method: 'turn/started',
      params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
    })
    reply({
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId: `item_${turnIndex}`, delta: 'Hello.' },
    })
    reply({
      method: 'turn/completed',
      params: { threadId, turn: { id: turnId, status: 'completed' } },
    })
  } else if (message.method === 'turn/interrupt') {
    reply({ id, result: {} })
  } else if (message.method === 'thread/read') {
    reply({ id, result: { thread: { id: threadId, turns: [{ id: 'turn_1' }] } } })
  } else if (message.method === 'thread/resume') {
    reply({ id, result: { thread: { id: threadId } } })
  }
})
