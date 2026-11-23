import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decryptSecret,
  encryptSecret,
  validateOutboundUrl,
  validateProjectName,
  validateProviderConnection,
} from './security.js'

test('encrypts credentials with authenticated encryption', () => {
  const encrypted = encryptSecret('sk-secret-value', 'test-key-material')
  assert.notEqual(encrypted, 'sk-secret-value')
  assert.equal(decryptSecret(encrypted, 'test-key-material'), 'sk-secret-value')
  assert.throws(() => decryptSecret(encrypted, 'wrong-key'))
})

test('accepts outbound URLs without host or scheme allowlists', () => {
  assert.equal(validateOutboundUrl('https://api.example.com/'), 'https://api.example.com')
  assert.equal(validateOutboundUrl('http://evil.example.com'), 'http://evil.example.com')
  assert.equal(validateOutboundUrl('https://127.0.0.1'), 'https://127.0.0.1')
  assert.equal(validateOutboundUrl('https://10.0.0.2'), 'https://10.0.0.2')
  assert.equal(validateOutboundUrl('ftp://evil.example.com'), 'ftp://evil.example.com')
  assert.throws(() => validateOutboundUrl('https://user:password@api.example.com'))
})

test('accepts safe project directory names and rejects traversal', () => {
  assert.equal(validateProjectName('demo-project_1'), 'demo-project_1')
  for (const name of ['..', '.', '../escape', 'nested/project', ''])
    assert.throws(() => validateProjectName(name))
})

test('validates provider credentials without following redirects', async () => {
  let request: { input: string | URL | Request; init?: RequestInit } | undefined
  await validateProviderConnection('https://api.example.com', 'secret', async (input, init) => {
    request = { input, init }
    return new Response('{}', { status: 200 })
  })
  assert.equal(request?.input, 'https://api.example.com/models')
  assert.equal(request?.init?.redirect, 'manual')
  assert.equal(new Headers(request?.init?.headers).get('authorization'), 'Bearer secret')
  await assert.rejects(() =>
    validateProviderConnection(
      'https://api.example.com',
      'bad',
      async () => new Response('', { status: 401 }),
    ),
  )
})
