import { mkdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { and, asc, eq, isNull } from 'drizzle-orm'

import {
  credential,
  owner,
  project,
} from './db/schema.js'
import type { ServerConfig } from './config.js'
import type { Database } from './database.js'
import {
  decryptSecret,
  encryptSecret,
  validateOutboundUrl,
  validateProjectName,
  validateProviderConnection,
} from './security.js'

function userRoot(config: ServerConfig, userId: string) {
  return path.resolve(config.dataRoot, 'users', userId)
}

export function createWorkspaceService(
  config: ServerConfig,
  db: Database,
  verifyConnection = validateProviderConnection,
) {
  return {
    async hasOwner() {
      const [existing] = await db.select({ id: owner.id }).from(owner).limit(1)
      return Boolean(existing)
    },
    async createOwner(ownerId: string) {
      await db.insert(owner).values({ id: ownerId, runtimeInitializedAt: new Date() })
    },
    async getOnlyOwnerId() {
      const [existing] = await db.select({ id: owner.id }).from(owner).limit(1)
      return existing?.id ?? null
    },
    getUserRoot(userId: string) {
      return userRoot(config, userId)
    },
    async listProjects(userId: string) {
      return db
        .select({
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })
        .from(project)
        .where(eq(project.ownerId, userId))
    },
    async listProjectLocations(userId: string) {
      return db
        .select({ id: project.id, path: project.path })
        .from(project)
        .where(eq(project.ownerId, userId))
    },
    async getProject(userId: string, projectId: string) {
      const [record] = await db
        .select({ id: project.id, path: project.path, name: project.name })
        .from(project)
        .where(and(eq(project.id, projectId), eq(project.ownerId, userId)))
      return record
    },
    async createProject(userId: string, rawName: string) {
      const name = validateProjectName(rawName)
      const root = userRoot(config, userId)
      const projectPath = path.join(root, name)
      const [existing] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.ownerId, userId), eq(project.name, name)))
      if (existing) throw new ProjectConflictError()
      await mkdir(root, { recursive: true })
      try {
        await mkdir(projectPath)
      } catch (error) {
        // A deleted Project intentionally leaves its directory behind. Reuse it
        // when the logical Project is recreated, while still rejecting paths
        // outside the user's controlled root through the constructed path.
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const existingPath = path.resolve(projectPath)
          if (path.dirname(existingPath) !== path.resolve(root))
            throw new Error('Invalid project path', { cause: error })
          const existingEntry = await stat(existingPath)
          if (!existingEntry.isDirectory())
            throw new Error('Project path is not a directory', { cause: error })
        } else throw error
      }
      try {
        const id = randomUUID()
        const [created] = await db
          .insert(project)
          .values({ id, ownerId: userId, name, path: projectPath })
          .returning({
            id: project.id,
            name: project.name,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          })
        return created
      } catch (error) {
        await rm(projectPath, { recursive: true, force: true })
        throw error
      }
    },
    async renameProject(
      userId: string,
      projectId: string,
      rawName: string,
    ): Promise<{ id: string; name: string; createdAt: Date; updatedAt: Date } | undefined> {
      const name = validateProjectName(rawName)
      const [existing] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.ownerId, userId), eq(project.name, name)))
      if (existing && existing.id !== projectId) throw new ProjectConflictError()
      const [updated] = await db
        .update(project)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(project.ownerId, userId), eq(project.id, projectId)))
        .returning({
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })
      return updated
    },
    async deleteProject(userId: string, projectId: string) {
      const [deleted] = await db
        .delete(project)
        .where(and(eq(project.ownerId, userId), eq(project.id, projectId)))
        .returning({ id: project.id })
      return Boolean(deleted)
    },
    async listCredentials(userId: string) {
      return db
        .select({
          id: credential.id,
          provider: credential.provider,
          baseUrl: credential.baseUrl,
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
        })
        .from(credential)
        .where(eq(credential.ownerId, userId))
        .orderBy(asc(credential.createdAt), asc(credential.id))
    },
    async getCredential(userId: string, credentialId: string) {
      const [record] = await db
        .select({
          id: credential.id,
          provider: credential.provider,
          baseUrl: credential.baseUrl,
          encryptedApiKey: credential.encryptedApiKey,
        })
        .from(credential)
        .where(and(eq(credential.id, credentialId), eq(credential.ownerId, userId)))
      if (!record) return undefined
      return {
        ...record,
        apiKey: decryptSecret(record.encryptedApiKey, config.credentialEncryptionKey),
      }
    },
    async testCredential(userId: string, credentialId: string) {
      const saved = await this.getCredential(userId, credentialId)
      if (!saved) return false
      await verifyConnection(saved.baseUrl, saved.apiKey)
      return true
    },
    async saveCredential(
      userId: string,
      input: { provider: string; baseUrl: string; apiKey: string },
    ) {
      const provider = input.provider.trim()
      if (!/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(provider)) throw new Error('provider is invalid')
      if (['openai', 'ollama', 'lmstudio'].includes(provider.toLowerCase()))
        throw new Error('provider is reserved')
      if (!input.apiKey.trim()) throw new Error('apiKey is required')
      const baseUrl = validateOutboundUrl(
        input.baseUrl,
        config.allowedOutboundSchemes,
        config.allowedOutboundHosts,
      )
      await verifyConnection(baseUrl, input.apiKey)
      const id = randomUUID()
      const [saved] = await db
        .insert(credential)
        .values({
          id,
          ownerId: userId,
          provider,
          baseUrl,
          encryptedApiKey: encryptSecret(input.apiKey, config.credentialEncryptionKey),
        })
        .returning({
          id: credential.id,
          provider: credential.provider,
          baseUrl: credential.baseUrl,
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
        })
      const [ownerRecord] = await db
        .select({ currentCredentialId: owner.currentCredentialId })
        .from(owner)
        .where(eq(owner.id, userId))
      if (!ownerRecord?.currentCredentialId) {
        const [fallback] = await db
          .select({ id: credential.id })
          .from(credential)
          .where(eq(credential.ownerId, userId))
          .orderBy(asc(credential.createdAt), asc(credential.id))
          .limit(1)
        await db
          .update(owner)
          .set({ currentCredentialId: fallback?.id ?? saved.id })
          .where(and(eq(owner.id, userId), isNull(owner.currentCredentialId)))
      }
      return saved
    },
    async getCurrentCredentialId(userId: string): Promise<string | null> {
      const [ownerRecord] = await db
        .select({ currentCredentialId: owner.currentCredentialId })
        .from(owner)
        .where(eq(owner.id, userId))
      if (ownerRecord?.currentCredentialId) {
        const current = await this.getCredential(userId, ownerRecord.currentCredentialId)
        if (current) return current.id
      }
      const [fallback] = await db
        .select({ id: credential.id })
        .from(credential)
        .where(eq(credential.ownerId, userId))
        .orderBy(asc(credential.createdAt), asc(credential.id))
        .limit(1)
      const currentCredentialId = fallback?.id ?? null
      await db.update(owner).set({ currentCredentialId }).where(eq(owner.id, userId))
      return currentCredentialId
    },
    async setCurrentCredentialId(userId: string, credentialId: string) {
      if (!(await this.getCredential(userId, credentialId))) return false
      const [updated] = await db
        .update(owner)
        .set({ currentCredentialId: credentialId })
        .where(eq(owner.id, userId))
        .returning({ id: owner.id })
      return Boolean(updated)
    },
    async deleteCredential(userId: string, id: string) {
      const currentCredentialId = await this.getCurrentCredentialId(userId)
      const [deleted] = await db
        .delete(credential)
        .where(and(eq(credential.ownerId, userId), eq(credential.id, id)))
        .returning({ id: credential.id })
      if (deleted?.id && currentCredentialId === deleted.id) {
        const [fallback] = await db
          .select({ id: credential.id })
          .from(credential)
          .where(eq(credential.ownerId, userId))
          .orderBy(asc(credential.createdAt), asc(credential.id))
          .limit(1)
        await db
          .update(owner)
          .set({ currentCredentialId: fallback?.id ?? null })
          .where(eq(owner.id, userId))
      }
      return Boolean(deleted)
    },
  }
}

export class ProjectConflictError extends Error {
  constructor() {
    super('Project already exists')
    this.name = 'ProjectConflictError'
  }
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>
