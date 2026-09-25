export type RuntimeModel = {
  id: string
  displayName: string
  defaultReasoningEffort?: string
  reasoningEfforts: Array<{ id: string; description?: string }>
  inputModalities: string[]
  supportsPersonality?: boolean
}

export function projectModelCatalog(
  value: unknown,
  allowedModels?: readonly string[],
  allowedEfforts?: readonly string[],
) {
  const rows =
    value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : []
  const allowModel = allowedModels?.length ? new Set(allowedModels) : null
  const allowEffort = allowedEfforts?.length ? new Set(allowedEfforts) : null
  return rows.flatMap((row): RuntimeModel[] => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const id =
      typeof item.id === 'string' ? item.id : typeof item.model === 'string' ? item.model : ''
    if (!id || (allowModel && !allowModel.has(id))) return []
    const reasoningEfforts = Array.isArray(item.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const value = entry as Record<string, unknown>
          const effort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort : ''
          return effort && (!allowEffort || allowEffort.has(effort))
            ? [
                {
                  id: effort,
                  ...(typeof value.description === 'string'
                    ? { description: value.description }
                    : {}),
                },
              ]
            : []
        })
      : []
    if (!reasoningEfforts.length) return []
    return [
      {
        id,
        displayName: typeof item.displayName === 'string' ? item.displayName : id,
        ...(typeof item.defaultReasoningEffort === 'string'
          ? { defaultReasoningEffort: item.defaultReasoningEffort }
          : {}),
        reasoningEfforts,
        inputModalities: Array.isArray(item.inputModalities)
          ? item.inputModalities.filter((x): x is string => typeof x === 'string')
          : ['text'],
        ...(typeof item.supportsPersonality === 'boolean'
          ? { supportsPersonality: item.supportsPersonality }
          : {}),
      },
    ]
  })
}
