import 'dotenv/config'
import process from 'node:process'
import { createHmac, randomBytes } from 'node:crypto'
import readline from 'node:readline/promises'

import { createAuth } from '../src/auth.js'
import { loadServerConfig } from '../src/config.js'
import { createDatabase } from '../src/database.js'
import { RemoteTrustStore } from '../src/remote/trust-store.js'
import { RemoteBootstrapStore } from '../src/remote/bootstrap-store.js'

function parseArgs(args: string[]) {
  const options: Record<string, string> = {}
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx)
        const value = arg.slice(eqIdx + 1)
        options[key] = value
      } else {
        options[arg.slice(2)] = 'true'
      }
    }
  }
  return options
}

async function prompt(
  rl: readline.Interface,
  question: string,
  fallback: string = '',
): Promise<string> {
  const answer = await rl.question(question)
  return answer.trim() || fallback
}

async function promptHidden(question: string): Promise<string> {
  const input = process.stdin
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Hidden password input requires an interactive terminal')
  }

  process.stdout.write(question)
  input.setRawMode(true)
  input.resume()

  return new Promise((resolve, reject) => {
    let password = ''
    const decoder = new TextDecoder()
    const cleanup = (error?: Error) => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(password)
    }
    const onData = (chunk: Buffer | string) => {
      for (const character of typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true })) {
        if (character === '\u0003') {
          cleanup(new Error('Password input cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          return
        }
        if (character === '\u007f' || character === '\b') {
          password = Array.from(password).slice(0, -1).join('')
          continue
        }
        if (character >= ' ' && character !== '\u007f') password += character
      }
    }
    input.on('data', onData)
  })
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))
  const isInteractive = process.stdin.isTTY && !cliOptions.email
  let email = cliOptions.email
  let password = cliOptions.password
  let name = cliOptions.name

  if (isInteractive) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    try {
      console.log('--- Create Codex Web Account ---')
      const defaultEmail = 'owner@codex.local'
      if (!email) {
        email = await prompt(rl, `Email [${defaultEmail}]: `, defaultEmail)
      }

      if (!name) {
        const defaultName = 'Owner'
        name = await prompt(rl, `Display Name [${defaultName}]: `, defaultName)
      }
    } finally {
      rl.close()
    }

    if (!password) {
      password = await promptHidden('Password (leave empty to generate a secure random password): ')
    }
  }

  email = email || 'owner@codex.local'
  name = name || 'Owner'

  let passwordGenerated = false
  if (!password) {
    password = randomBytes(18).toString('base64url')
    passwordGenerated = true
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  const config = loadServerConfig()
  const database = createDatabase(config)

  try {
    const auth = createAuth(config, database.db)
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    })

    console.log('\n=========================================')
    console.log(`Account created successfully!`)
    console.log(`User ID:  ${result.user.id}`)
    console.log(`Email:    ${result.user.email}`)
    console.log(`Name:     ${result.user.name}`)
    if (passwordGenerated) {
      console.log(`Password: ${password}`)
      console.log('WARNING: This generated password will only be displayed once!')
    }
    if (config.remoteRelayUrl && config.remoteRelayOwnerToken) {
      const identity = await new RemoteTrustStore(config.dataRoot).identity()
      const capability = await new RemoteBootstrapStore(config.dataRoot).issue(
        identity.nodeId,
        identity.trustEpoch,
      )
      if (!config.remoteAppUrl) throw new Error('REMOTE_APP_REQUIRED')
      if (!config.remoteAppUrl.startsWith('https://')) throw new Error('INVALID_REMOTE_APP_URL')
      const bootstrapUrl = new URL(config.remoteAppUrl)
      bootstrapUrl.hash = new URLSearchParams({
        bootstrapId: capability.bootstrapId,
        nodeId: identity.nodeId,
        trustEpoch: String(identity.trustEpoch),
        relayUrl: config.remoteRelayUrl,
        clientToken: signBootstrapToken(config.remoteRelayOwnerToken, {
          nodeId: identity.nodeId,
          trustEpoch: identity.trustEpoch,
          role: 'client',
          admission: 'bootstrap',
          purpose: 'bootstrap-attach',
          bootstrapId: capability.bootstrapId,
          expiresAt: capability.expiresAt,
        }),
      }).toString()
      console.log(`Bootstrap URL (one-time): ${bootstrapUrl.toString()}`)
    }
    console.log('=========================================\n')
  } finally {
    database.driver.close()
  }
}

function signBootstrapToken(secret: string, claims: Record<string, string | number>) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unable to create account'
  console.error(`Failed to create account: ${message}`)
  process.exitCode = 1
})
