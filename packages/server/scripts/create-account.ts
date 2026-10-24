import 'dotenv/config'
import process from 'node:process'
import { randomBytes } from 'node:crypto'
import readline from 'node:readline/promises'

import { createAuth } from '../src/auth.js'
import { loadServerConfig } from '../src/config.js'
import { createDatabase } from '../src/database.js'

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

      if (!password) {
        const enteredPassword = await prompt(
          rl,
          'Password (leave empty to generate a secure random password): ',
          '',
        )
        password = enteredPassword
      }
    } finally {
      rl.close()
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
    console.log('=========================================\n')
  } finally {
    database.driver.close()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unable to create account'
  console.error(`Failed to create account: ${message}`)
  process.exitCode = 1
})
