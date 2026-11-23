export type ThemeVariant = 'light' | 'dark'

export type ThemeInput = {
  id: string
  family: string
  name: string
  variant: ThemeVariant
  surface: string
  ink: string
  accent: string
  diffAdded: string
  diffRemoved: string
  skill: string
}

/** Validate seeds before generation; never silently repair malformed input. */
export function validateThemeInputs(inputs: readonly ThemeInput[]) {
  const ids = new Set<string>()
  for (const input of inputs) {
    if (
      !input.family ||
      !input.name ||
      !['light', 'dark'].includes(input.variant) ||
      input.id !== `${input.family}-${input.variant}` ||
      ids.has(input.id)
    ) {
      throw new Error(`Invalid or duplicate theme identity: ${input.id}`)
    }
    ids.add(input.id)
    for (const key of ['surface', 'ink', 'accent', 'diffAdded', 'diffRemoved', 'skill'] as const) {
      if (!/^#[0-9a-f]{6}$/.test(input[key])) {
        throw new Error(`Invalid ${key} seed for ${input.id}`)
      }
    }
  }
}
