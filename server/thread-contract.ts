import path from 'node:path'

import { record } from './codex/native-protocol.js'

export type ProjectLocation = { id: string; path: string }

export type ThreadSummary = {
  id: string
  projectId: string | null
  title: string
  status: 'notLoaded' | 'idle' | 'systemError' | 'active'
  createdAt: number
  updatedAt: number
  recencyAt: number | null
  modelProvider: string
}

function normalizedPath(value: string) {
  const normalized = path.resolve(value)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function titleForThread(thread: Record<string, unknown>) {
  const name = typeof thread.name === 'string' ? thread.name.trim() : ''
  const preview = typeof thread.preview === 'string' ? thread.preview.trim() : ''
  return name || preview || 'Untitled thread'
}

function threadStatus(value: unknown): ThreadSummary['status'] {
  const type = record(value) ? value.type : undefined
  return type === 'idle' || type === 'systemError' || type === 'active' ? type : 'notLoaded'
}

export function createProjectPathIndex(projects: ProjectLocation[]) {
  return new Map(projects.map((project) => [normalizedPath(project.path), project.id]))
}

export function projectIdForThread(value: unknown, projects: Map<string, string>): string | null {
  const cwd = record(value) ? value.cwd : undefined
  return typeof cwd === 'string' ? (projects.get(normalizedPath(cwd)) ?? null) : null
}

export function sanitizeThreadSummary(
  value: unknown,
  projectId: string | null,
): ThreadSummary | null {
  if (!record(value)) return null
  if (value.ephemeral === true || value.parentThreadId != null) return null
  if (typeof value.id !== 'string' || typeof value.preview !== 'string') return null
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') return null
  return {
    id: value.id,
    projectId,
    title: titleForThread(value),
    status: threadStatus(value.status),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    recencyAt: typeof value.recencyAt === 'number' ? value.recencyAt : null,
    modelProvider: typeof value.modelProvider === 'string' ? value.modelProvider : 'unknown',
  }
}
