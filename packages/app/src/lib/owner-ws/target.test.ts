import { describe, expect, it } from 'vitest'
import { ownerTargetKind } from './target'

describe('Owner target origin selection', () => {
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'uses local Owner access for %s',
    (origin) => {
      expect(ownerTargetKind(origin)).toBe('local')
    },
  )

  it.each(['http://localhost:5174', 'http://[::1]:5173', 'https://app.example.test'])(
    'uses remote admission for %s',
    (origin) => {
      expect(ownerTargetKind(origin)).toBe('remote')
    },
  )
})
