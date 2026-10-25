import { describe, expect, it } from 'vitest'
import { consumeRemoteBootstrap } from './bootstrap'
import { canInvokeRemoteMethod } from './state'

describe('remote bootstrap', () => {
  it('consumes fragment and returns a clean URL', () => {
    const result = consumeRemoteBootstrap(
      'https://remote.example/app#kind=codex-remote-bootstrap&bootstrapId=b&nodeId=n&trustEpoch=2&relayUrl=wss%3A%2F%2Frelay&clientToken=t',
    )
    expect(result.value?.bootstrapId).toBe('b')
    expect(result.value?.trustEpoch).toBe(2)
    expect(result.cleanUrl).toBe('https://remote.example/app')
  })

  it('rejects malformed fragments', () => {
    expect(
      consumeRemoteBootstrap('https://remote.example/#kind=codex-remote-bootstrap&trustEpoch=-1')
        .value,
    ).toBeNull()
  })
})

describe('remote permissions', () => {
  it('keeps pending sessions restricted', () => {
    expect(canInvokeRemoteMethod('pending_totp', 'threads.list')).toBe(false)
    expect(canInvokeRemoteMethod('pending_totp', 'remote.device.binding.verifyTotp')).toBe(true)
    expect(canInvokeRemoteMethod('paired', 'threads.list')).toBe(true)
  })
})
