import { createHmac, timingSafeEqual } from 'node:crypto'

export type AdmissionPurpose = 'paired-attach'
export type AdmissionClaims = {
  nodeId: string
  trustEpoch: number
  role: 'client' | 'owner'
  purpose: AdmissionPurpose
  deviceId?: string
  expiresAt: number
}

export function signAdmissionToken(secret: string, claims: AdmissionClaims): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`
}

export function verifyAdmissionToken(
  token: string,
  secret: string,
  expectedPurpose?: AdmissionPurpose,
): AdmissionClaims | null {
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(encoded).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (
      !isRecord(value) ||
      typeof value.nodeId !== 'string' ||
      !Number.isSafeInteger(value.trustEpoch) ||
      (value.role !== 'client' && value.role !== 'owner') ||
      value.purpose !== 'paired-attach' ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now() ||
      (expectedPurpose && value.purpose !== expectedPurpose)
    )
      return null
    if (value.purpose === 'paired-attach' && typeof value.deviceId !== 'string') return null
    return value as AdmissionClaims
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
