import { getOwnerBridge } from '../owner-runtime'
import type { RuntimeCapabilityModel } from '@/app/chat/composer/model/composer-capabilities'

export type ContextWindowConfig = { modelContextWindow: number }

export async function fetchContextWindow(signal?: AbortSignal): Promise<ContextWindowConfig> {
  return (await getOwnerBridge().request('configuration.contextWindow.read', undefined, {
    signal,
  })) as ContextWindowConfig
}

export async function updateContextWindow(modelContextWindow: number): Promise<void> {
  await getOwnerBridge().request(
    'configuration.contextWindow.write',
    { modelContextWindow },
    { mutation: true },
  )
}

export async function fetchRuntimeCapabilities(
  signal?: AbortSignal,
): Promise<{ models: readonly RuntimeCapabilityModel[] }> {
  return (await getOwnerBridge().request('capabilities.list', undefined, { signal })) as {
    models: readonly RuntimeCapabilityModel[]
  }
}
