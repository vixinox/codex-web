import { randomUUID } from 'node:crypto'

type InitializationWorkspace = {
  getOnlyOwnerId(): Promise<string | null>
  createOwner(ownerId: string): Promise<void>
}

export async function ensureOwnerInitialized(workspace: InitializationWorkspace) {
  const existingOwnerId = await workspace.getOnlyOwnerId()
  if (existingOwnerId) return existingOwnerId
  const ownerId = randomUUID()
  await workspace.createOwner(ownerId)
  return ownerId
}
