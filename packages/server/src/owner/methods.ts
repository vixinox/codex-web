import type { OwnerApplicationServices } from './application-services.js'
import type { OwnerAdmission, OwnerMethodRegistry } from './session-runtime.js'

export function createOwnerMethodRegistry(services: OwnerApplicationServices): OwnerMethodRegistry {
  return new Map([
    [
      'owner.status',
      {
        access: 'public' as const,
        handle: (_params, context) => services.ownerStatus(context),
      },
    ],
    [
      'owner.bootstrap.create',
      {
        access: 'local' as const,
        handle: async (params, context) => {
          const result = await services.bootstrapCreate(context, asRecord(params))
          context.authenticate(result.admission satisfies OwnerAdmission)
          return { token: result.token, session: result.session }
        },
      },
    ],
    [
      'owner.session.open',
      {
        access: 'public' as const,
        handle: async (params, context) => {
          const result = await services.sessionOpen(asRecord(params))
          context.authenticate(result.admission satisfies OwnerAdmission)
          return { token: result.token, session: result.session }
        },
      },
    ],
    [
      'owner.session.close',
      {
        access: 'authenticated' as const,
        closeAfterResponse: true,
        handle: (_params, context) => services.sessionClose(context),
      },
    ],
    [
      'credentials.list',
      {
        access: 'authenticated' as const,
        handle: (_params, context) => services.credentialsList(context),
      },
    ],
    [
      'credentials.create',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.credentialCreate(context, asRecord(params)),
      },
    ],
    [
      'credentials.test',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.credentialTest(context, asRecord(params)),
      },
    ],
    [
      'credentials.select',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.credentialSelect(context, asRecord(params)),
      },
    ],
    [
      'credentials.delete',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.credentialDelete(context, asRecord(params)),
      },
    ],
    [
      'projects.list',
      {
        access: 'authenticated' as const,
        handle: (_params, context) => services.projectsList(context),
      },
    ],
    [
      'projects.create',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.projectCreate(context, asRecord(params)),
      },
    ],
    [
      'projects.rename',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.projectRename(context, asRecord(params)),
      },
    ],
    [
      'projects.delete',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.projectDelete(context, asRecord(params)),
      },
    ],
    [
      'codex.status',
      {
        access: 'authenticated' as const,
        handle: (_params, context) => services.codexStatus(context),
      },
    ],
    [
      'capabilities.list',
      {
        access: 'authenticated' as const,
        handle: (_params, context) => services.capabilitiesList(context),
      },
    ],
    [
      'configuration.contextWindow.read',
      {
        access: 'authenticated' as const,
        handle: (_params, context) => services.configurationContextWindowRead(context),
      },
    ],
    [
      'configuration.contextWindow.write',
      {
        access: 'authenticated' as const,
        handle: (params, context) =>
          services.configurationContextWindowWrite(context, asRecord(params)),
      },
    ],
    [
      'codex.start',
      {
        access: 'authenticated' as const,
        handle: (params, context) =>
          services.codexLifecycle(context, { operation: 'start', ...asRecord(params) }),
      },
    ],
    [
      'codex.restart',
      {
        access: 'authenticated' as const,
        handle: (params, context) =>
          services.codexLifecycle(context, { operation: 'restart', ...asRecord(params) }),
      },
    ],
    [
      'skills.list',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.skillsList(context, asRecord(params)),
      },
    ],
    [
      'threads.list',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsList(context, asRecord(params)),
      },
    ],
    [
      'threads.create',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsCreate(context, asRecord(params)),
      },
    ],
    [
      'threads.read',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsRead(context, asRecord(params)),
      },
    ],
    [
      'threads.status',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsStatus(context, asRecord(params)),
      },
    ],
    [
      'threads.send',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsSend(context, asRecord(params)),
      },
    ],
    [
      'threads.cancel',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsCancel(context, asRecord(params)),
      },
    ],
    [
      'threads.compact',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsCompact(context, asRecord(params)),
      },
    ],
    [
      'threads.archive',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsArchive(context, asRecord(params)),
      },
    ],
    [
      'threads.unarchive',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsUnarchive(context, asRecord(params)),
      },
    ],
    [
      'threads.delete',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsDelete(context, asRecord(params)),
      },
    ],
    [
      'threads.deleteAll',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.threadsDeleteAll(context, asRecord(params)),
      },
    ],
    [
      'userInput.respond',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.userInputRespond(context, asRecord(params)),
      },
    ],
    [
      'approvals.resolve',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.approvalsResolve(context, asRecord(params)),
      },
    ],
    [
      'events.subscribe',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.eventsSubscribe(context, asRecord(params)),
      },
    ],
    [
      'events.resume',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.eventsResume(context, asRecord(params)),
      },
    ],
    [
      'remote.status',
      {
        access: 'authenticated' as const,
        handle: (_params, context) => services.remoteStatus(context),
      },
    ],
    [
      'remote.pairing.offer',
      {
        access: 'authenticated' as const,
        handle: (params, context) => services.remotePairingOffer(context, asRecord(params)),
      },
    ],
    [
      'remote.trust.reset',
      {
        access: 'authenticated' as const,
        handle: (_params, context) => services.remoteTrustReset(context),
      },
    ],
  ])
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
