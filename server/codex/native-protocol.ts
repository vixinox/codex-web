export type NativeCodexMessage = {
  method: string
  params?: Record<string, unknown>
  id?: number | string
}
export type NativeProjectionErrorCode = 'INVALID_MESSAGE'
export type NativeProjectionResult =
  | { ok: true; value: NativeCodexMessage }
  | { ok: false; code: NativeProjectionErrorCode }

const MAX_TEXT = 16_000
const MAX_DIFF = 32_000
const CHAT_MODELS = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'])
const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh'])

// App Server DTOs are not browser DTOs. Keep only reviewed, renderable fields.
export function projectNativeMessage(value: unknown): NativeProjectionResult {
  if (!record(value) || typeof value.method !== 'string' || !record(value.params)) return invalid()
  const p = value.params
  const threadId = messageThreadId(p)
  const turnId = text(p.turnId)
  let params: Record<string, unknown> | undefined
  if (value.method === 'thread/status/changed')
    params = compact({ threadId, status: status(p.status) })
  else if (value.method === 'thread/started')
    params = compact({ threadId, thread: projectNativeThread(p.thread) })
  else if (value.method === 'thread/tokenUsage/updated')
    params = compact({ threadId, turnId, tokenUsage: tokenUsage(p.tokenUsage) })
  else if (value.method === 'webcodex/guest-token-limit')
    params = compact({
      threadId,
      turnId,
      maxTokens: positiveInteger(p.maxTokens),
      actualTokens: nonNegativeInteger(p.actualTokens),
    })
  else if (value.method === 'thread/settings/updated') {
    const settings = record(p.threadSettings) ? p.threadSettings : {}
    params = compact({
      threadId,
      model: chatModel(settings.model),
      reasoningEffort: reasoningEffort(settings.effort),
    })
  } else if (['turn/started', 'turn/completed', 'turn/failed'].includes(value.method))
    params = compact({
      threadId,
      turn: turn(p.turn),
      ...(value.method === 'turn/started' ? {} : { tokenUsage: tokenUsage(p.tokenUsage) }),
    })
  else if (value.method === 'error')
    params = compact({ threadId, turnId, error: error(p.error ?? p) })
  else if (value.method === 'turn/plan/updated')
    params = compact({ threadId, turnId, plan: plan(p.plan), explanation: text(p.explanation) })
  else if (value.method === 'turn/diff/updated')
    params = compact({ threadId, turnId, ...bounded('diff', p.diff, MAX_DIFF) })
  else if (value.method === 'item/fileChange/patchUpdated')
    params = compact({ threadId, turnId, itemId: text(p.itemId), changes: changes(p.changes) })
  else if (value.method === 'item/started' || value.method === 'item/completed')
    params = compact({ threadId, turnId, item: item(p.item) })
  else if (
    [
      'item/agentMessage/delta',
      'item/commandExecution/outputDelta',
      'item/plan/delta',
      'item/reasoning/summaryTextDelta',
    ].includes(value.method)
  )
    params = compact({
      threadId,
      turnId,
      itemId: text(p.itemId),
      summaryIndex: numeric(p.summaryIndex),
      ...bounded('delta', p.delta, MAX_TEXT),
    })
  else if (value.method === 'item/reasoning/summaryPartAdded')
    params = compact({ threadId, turnId, itemId: text(p.itemId) })
  else if (value.method === 'item/mcpToolCall/progress')
    params = compact({
      threadId,
      turnId,
      itemId: text(p.itemId),
      ...bounded('message', p.message, MAX_TEXT),
    })
  else if (value.method === 'item/tool/requestUserInput')
    params = compact({
      threadId,
      turnId,
      itemId: text(p.itemId),
      requestId: requestId(p.requestId),
      isBlocking: bool(p.isBlocking),
      questions: questions(p.questions),
    })
  else if (value.method === 'serverRequest/resolved')
    params = compact({ threadId, requestId: requestId(p.requestId) })
  else if (value.method === 'webcodex/userInput/answered')
    params = compact({
      threadId,
      requestId: requestId(p.requestId),
      answers: questionnaireAnswers(p.answers),
    })
  else if (value.method === 'item/commandExecution/requestApproval')
    params = compact({ threadId, turnId, requestId: requestId(p.requestId) })
  else return invalid()
  const id = requestId(value.id)
  return {
    ok: true,
    value: {
      method: value.method,
      params,
      ...(id !== undefined ? { id } : {}),
    },
  }
}

export function projectNativeThread(value: unknown, projectPath?: string) {
  if (!record(value) || typeof value.id !== 'string') return undefined
  return compact({
    id: value.id,
    name: text(value.name),
    preview: text(value.preview),
    model: chatModel(value.model),
    reasoningEffort: reasoningEffort(value.reasoningEffort),
    modelProvider: text(value.modelProvider),
    updatedAt: numeric(value.updatedAt),
    status: status(value.status),
    tokenUsage: tokenUsage(value.tokenUsage),
    turns: Array.isArray(value.turns)
      ? value.turns.flatMap((entry) => {
          const next = turn(entry, projectPath)
          return next ? [next] : []
        })
      : [],
  })
}

function turn(value: unknown, projectPath?: string) {
  if (!record(value) || typeof value.id !== 'string') return undefined
  return compact({
    id: value.id,
    status: text(value.status),
    startedAt: numeric(value.startedAt),
    completedAt: numeric(value.completedAt),
    durationMs: numeric(value.durationMs),
    error: error(value.error),
    plan: plan(value.plan),
    planExplanation: text(value.planExplanation),
    ...bounded('diff', value.diff, MAX_DIFF),
    items: Array.isArray(value.items)
      ? value.items.flatMap((entry) => {
          const next = item(entry, projectPath)
          return next ? [next] : []
        })
      : [],
  })
}

function item(value: unknown, projectPath?: string) {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.type !== 'string' ||
    value.type === 'hookPrompt'
  )
    return undefined
  const base = { id: value.id, type: value.type }
  if (value.type === 'userMessage') return { ...base, content: userContent(value.content) }
  if (value.type === 'agentMessage' || value.type === 'plan')
    return compact({ ...base, phase: text(value.phase), ...bounded('text', value.text, MAX_TEXT) })
  if (value.type === 'reasoning') return { ...base, summary: strings(value.summary) }
  if (value.type === 'commandExecution')
    return compact({
      ...base,
      status: text(value.status),
      ...bounded('command', value.command, MAX_TEXT),
      ...bounded('aggregatedOutput', value.aggregatedOutput, MAX_TEXT),
      exitCode: numeric(value.exitCode),
      durationMs: numeric(value.durationMs),
    })
  if (value.type === 'fileChange')
    return compact({
      ...base,
      status: text(value.status),
      changes: changes(value.changes, projectPath),
    })
  if (value.type === 'webSearch')
    return compact({ ...base, query: text(value.query), action: action(value.action) })
  if (value.type === 'mcpToolCall')
    return compact({
      ...base,
      server: text(value.server),
      tool: text(value.tool),
      status: text(value.status),
      durationMs: numeric(value.durationMs),
      readOnlyHint: bool(value.readOnlyHint),
      error: toolError(value.error),
      ...toolText(value.result),
    })
  if (value.type === 'dynamicToolCall')
    return compact({
      ...base,
      tool: text(value.tool),
      namespace: text(value.namespace),
      status: text(value.status),
      success: bool(value.success),
      durationMs: numeric(value.durationMs),
      ...toolContent(value.contentItems),
    })
  if (value.type === 'collabAgentToolCall')
    return compact({
      ...base,
      tool: text(value.tool),
      status: text(value.status),
      model: text(value.model),
      reasoningEffort: text(value.reasoningEffort),
      agentCount: Array.isArray(value.receiverThreadIds)
        ? value.receiverThreadIds.length
        : undefined,
    })
  if (value.type === 'subAgentActivity') return compact({ ...base, kind: text(value.kind) })
  if (value.type === 'imageGeneration')
    return compact({
      ...base,
      status: text(value.status),
      ...bounded('result', value.result, MAX_TEXT),
      ...bounded('revisedPrompt', value.revisedPrompt, MAX_TEXT),
      transparentBackground: bool(value.transparentBackground),
    })
  if (value.type === 'sleep') return compact({ ...base, durationMs: numeric(value.durationMs) })
  if (value.type === 'enteredReviewMode' || value.type === 'exitedReviewMode')
    return compact({ ...base, review: text(value.review) })
  if (value.type === 'contextCompaction') return compact({ ...base, status: text(value.status) })
  return base
}

function userContent(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((part) => {
        if (!record(part) || typeof part.type !== 'string') return []
        if (part.type === 'text')
          return [compact({ type: 'text', ...bounded('text', part.text, MAX_TEXT) })]
        if ((part.type === 'skill' || part.type === 'mention') && typeof part.name === 'string')
          return [{ type: part.type, name: part.name }]
        if (['image', 'localImage'].includes(part.type)) return [{ type: 'image' }]
        if (['audio', 'localAudio'].includes(part.type)) return [{ type: 'audio' }]
        return []
      })
    : []
}
function changes(value: unknown, projectPath?: string) {
  return Array.isArray(value)
    ? value.flatMap((change) =>
        record(change) &&
        typeof change.path === 'string' &&
        record(change.kind) &&
        typeof change.kind.type === 'string'
          ? [
              compact({
                path: pathName(change.path, projectPath),
                kind: compact({
                  type: change.kind.type,
                  move_path:
                    typeof change.kind.move_path === 'string'
                      ? pathName(change.kind.move_path, projectPath)
                      : undefined,
                }),
                ...bounded('diff', change.diff, MAX_DIFF),
              }),
            ]
          : [],
      )
    : []
}
function error(value: unknown) {
  return record(value)
    ? compact({
        ...bounded('message', value.message, MAX_TEXT),
        ...bounded('additionalDetails', value.additionalDetails, MAX_TEXT),
        codexErrorInfo: record(value.codexErrorInfo)
          ? compact({ httpStatusCode: numeric(value.codexErrorInfo.httpStatusCode) })
          : undefined,
      })
    : undefined
}
function toolError(value: unknown) {
  return record(value) ? compact({ ...bounded('message', value.message, MAX_TEXT) }) : undefined
}
function toolText(value: unknown) {
  return typeof value === 'string'
    ? bounded('result', value, MAX_TEXT)
    : record(value) && typeof value.text === 'string'
      ? bounded('result', value.text, MAX_TEXT)
      : {}
}
function toolContent(value: unknown) {
  const textItem = Array.isArray(value)
    ? value.find((entry) => record(entry) && typeof entry.text === 'string')
    : undefined
  return record(textItem) ? bounded('result', textItem.text, MAX_TEXT) : {}
}
function action(value: unknown) {
  if (!record(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'search')
    return compact({
      type: 'search',
      query: limitedText(value.query),
      queries: stringList(value.queries),
    })
  if (value.type === 'openPage') return compact({ type: 'openPage', url: limitedUrl(value.url) })
  if (value.type === 'findInPage')
    return compact({
      type: 'findInPage',
      url: limitedUrl(value.url),
      pattern: limitedText(value.pattern),
    })
  return undefined
}
function plan(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((step) =>
        record(step) && typeof step.step === 'string' && typeof step.status === 'string'
          ? [compact({ ...bounded('step', step.step, MAX_TEXT), status: step.status })]
          : [],
      )
    : undefined
}
function questions(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((question) =>
        record(question) && typeof question.id === 'string' && typeof question.question === 'string'
          ? [
              compact({
                id: question.id,
                header: text(question.header),
                ...bounded('question', question.question, MAX_TEXT),
                options: Array.isArray(question.options)
                  ? question.options.flatMap((option) =>
                      record(option) &&
                      typeof option.label === 'string' &&
                      typeof option.description === 'string'
                        ? [
                            compact({
                              label: option.label,
                              ...bounded('description', option.description, MAX_TEXT),
                            }),
                          ]
                        : [],
                    )
                  : question.options === null
                    ? null
                    : undefined,
                isSecret: bool(question.isSecret),
                isOther: bool(question.isOther),
              }),
            ]
          : [],
      )
    : []
}
function questionnaireAnswers(value: unknown) {
  if (!record(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).flatMap(([questionId, answer]) =>
      record(answer) && Array.isArray(answer.answers)
        ? [
            [
              questionId.slice(0, 256),
              {
                answers: answer.answers.flatMap((entry) =>
                  typeof entry === 'string' ? [sanitize(entry).slice(0, MAX_TEXT)] : [],
                ),
              },
            ],
          ]
        : [],
    ),
  )
}
function status(value: unknown) {
  return record(value) && typeof value.type === 'string'
    ? compact({
        type: value.type,
        activeFlags: Array.isArray(value.activeFlags)
          ? value.activeFlags.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
      })
    : undefined
}
function tokenUsage(value: unknown) {
  const breakdown = (entry: unknown) =>
    record(entry)
      ? compact({
          inputTokens: numeric(entry.inputTokens),
          outputTokens: numeric(entry.outputTokens),
          reasoningOutputTokens: numeric(entry.reasoningOutputTokens),
          totalTokens: numeric(entry.totalTokens),
        })
      : undefined
  return record(value)
    ? compact({
        modelContextWindow: numeric(value.modelContextWindow),
        last: breakdown(value.last),
        total: breakdown(value.total),
      })
    : undefined
}
function chatModel(value: unknown) {
  return typeof value === 'string' && value.length <= 64 && CHAT_MODELS.has(value)
    ? value
    : undefined
}
function reasoningEffort(value: unknown) {
  return typeof value === 'string' && value.length <= 16 && REASONING_EFFORTS.has(value)
    ? value
    : undefined
}
function bounded(name: string, value: unknown, limit: number) {
  if (typeof value !== 'string') return {}
  const next = sanitize(value)
  return next.length > limit ? { [name]: next.slice(0, limit), truncated: true } : { [name]: next }
}
function strings(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) =>
        typeof entry === 'string' ? [sanitize(entry).slice(0, MAX_TEXT)] : [],
      )
    : []
}
function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .flatMap((entry) => (typeof entry === 'string' ? [sanitize(entry).slice(0, MAX_TEXT)] : []))
        .slice(0, 16)
    : undefined
}
function limitedText(value: unknown) {
  return typeof value === 'string' ? sanitize(value).slice(0, MAX_TEXT) : undefined
}
function limitedUrl(value: unknown) {
  if (typeof value !== 'string') return undefined
  return value
    .replace(
      /((?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, '[redacted]')
    .slice(0, MAX_TEXT)
}
function sanitize(value: string) {
  return value
    .replace(
      /((?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, '[redacted]')
    .replace(/"[A-Za-z]:[\\/][^"]*?[\\/](pwsh|powershell)(?:\.exe)?"/gi, '"$1"')
    .replace(/"[A-Za-z]:[\\/][^"]+"/g, '"<path>"')
    .replace(/[A-Za-z]:[\\/](?:[^\\/\s"'`<>|]+[\\/])*[^\\/\s"'`<>|]*/g, '<path>')
    .replace(/\/(?:Users|home|private|tmp|var|workspace|opt)(?:\/[^\s"'`<>|]+)+/g, '<path>')
}
function pathName(value: string, projectPath?: string) {
  const normalized = value.replace(/\\/g, '/')
  const root = projectPath?.replace(/\\/g, '/').replace(/\/$/, '')
  if (
    root &&
    normalized.toLocaleLowerCase('en-US').startsWith(`${root.toLocaleLowerCase('en-US')}/`)
  )
    return normalized.slice(root.length + 1)
  return normalized.split('/').filter(Boolean).at(-1) ?? 'file'
}
function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown) {
  return typeof value === 'string' ? sanitize(value) : undefined
}
function numeric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
function bool(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}
function requestId(value: unknown) {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}
function invalid(): NativeProjectionResult {
  return { ok: false, code: 'INVALID_MESSAGE' }
}
function messageThreadId(params: Record<string, unknown>) {
  const direct = text(params.threadId)
  if (direct) return direct
  const thread = params.thread
  if (record(thread)) {
    const id = text(thread.id)
    if (id) return id
  }
  const turnRecord = params.turn
  return record(turnRecord) ? text(turnRecord.threadId) : undefined
}
