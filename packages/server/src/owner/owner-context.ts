import type { OwnerMethodContext, OwnerContext } from './session-runtime.js'
import { OwnerMethodError } from './errors.js'

export function requireOwner(context: OwnerMethodContext): OwnerContext {
  if (!context.owner) throw new OwnerMethodError('UNAUTHORIZED')
  return context.owner
}
