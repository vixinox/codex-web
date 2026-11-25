import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ServerConfig } from '../../config.js'
import type { WorkspaceService } from '../../workspace.js'
import { CodexRpcClient, type RpcTransport } from '../rpc-client.js'
import type { CodexRuntimeManager } from '../runtime-manager.js'
import type { CodexCommand } from '../stdio-transport.js'
import { log } from '../../logger.js'

type StartupInput = {
  config: ServerConfig
  workspace: Pick<WorkspaceService, 'getCredential'>
  runtime: CodexRuntimeManager
  injectedTransport: boolean
  transportFactory: (
    command: CodexCommand,
    options: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => RpcTransport
  attach: (client: CodexRpcClient, endpointHost: string) => void
}

/** Bootstraps and verifies one client, with listeners attached before initialization. */
export async function startCodexProcess(input: StartupInput, userId: string, credentialId: string) {
  const credential = await input.workspace.getCredential(userId, credentialId)
  if (!credential) throw new Error('Credential not found')
  const endpoints = describeProviderEndpoints(credential.baseUrl)
  log.info('codex.provider.configured', {
    provider: credential.provider.slice(0, 64),
    endpointHost: safeEndpointHost(endpoints.base),
  })
  const userRoot = path.resolve(input.config.dataRoot, 'users', userId)
  const userHome = path.join(userRoot, '.codex')
  await mkdir(userHome, { recursive: true })
  const configPath = path.join(userHome, 'config.toml')
  const provider = JSON.stringify(credential.provider)
  const configText = [
    `model_provider = ${provider}`,
    '',
    `[model_providers.${provider}]`,
    `name = ${provider}`,
    `base_url = ${JSON.stringify(credential.baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    '',
    'web_search = "live"',
    '',
    '[tools.web_search]',
    '',
  ].join('\n')
  const tempConfigPath = `${configPath}.${process.pid}.tmp`
  await writeFile(tempConfigPath, configText, { encoding: 'utf8', mode: 0o600 })
  await rename(tempConfigPath, configPath)
  const command = input.injectedTransport
    ? { executable: 'codex', args: [] }
    : await input.runtime.resolveCommand()
  const transport = input.transportFactory(command, {
    cwd: userRoot,
    env: {
      CODEX_HOME: userHome,
    },
  })
  const client = new CodexRpcClient(transport)
  input.attach(client, safeEndpointHost(endpoints.base))
  try {
    await startupRequest('initialize', () => client.initialize())
    await startupRequest('account/login/start', () =>
      client.request('account/login/start', { type: 'apiKey', apiKey: credential.apiKey }),
    )
    const account = (await startupRequest('account/read', () =>
      client.request('account/read', {}),
    )) as {
      account?: { type?: unknown }
      requiresOpenaiAuth?: unknown
    }
    if (account.account?.type !== 'apiKey' || account.requiresOpenaiAuth !== true) {
      throw new Error('Codex API-key authentication verification failed')
    }
  } catch (error) {
    client.stop()
    throw error
  }
  return { client, credentialId }
}

function describeProviderEndpoints(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl)
    const base = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
    return {
      base,
      models: `${base}/models`,
      responses: `${base}/responses`,
    }
  } catch {
    const base = '[invalid-provider-url]'
    return { base, models: base, responses: base }
  }
}

function safeEndpointHost(value: string) {
  try {
    return new URL(value).hostname.slice(0, 128)
  } catch {
    return 'invalid'
  }
}

async function startupRequest<T>(name: string, operation: () => Promise<T>): Promise<T> {
  log.info('codex.rpc.startup-request', { method: name.slice(0, 80) })
  let timer: NodeJS.Timeout | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Codex App Server ${name} timed out after 30s`)),
        30_000,
      )
      void operation().then(resolve, reject)
    })
  } catch (error) {
    throw new Error(`Codex App Server ${name} failed`, { cause: error })
  } finally {
    if (timer) clearTimeout(timer)
  }
}
