import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createProject, deleteProject, fetchProjects, renameProject } from './projects'

describe('project transport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('projects responses without retaining a server path', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          projects: [
            {
              id: 'project-1',
              name: 'demo',
              path: 'C:/private/users/user-1/demo',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const projects = await fetchProjects()

    expect(projects).toEqual([{ id: 'project-1', name: 'demo' }])
    expect(JSON.stringify(projects)).not.toContain('path')
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    )
  })

  it('returns a safe error for a failed request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'private path' } }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )

    await expect(fetchProjects()).rejects.toMatchObject({
      message: 'The server is temporarily unavailable.',
      status: 500,
    })
  })

  it('creates, renames and removes Projects through authenticated requests', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'project-1', name: 'demo' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'project-1', name: 'renamed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await expect(createProject('demo')).resolves.toMatchObject({ id: 'project-1', name: 'demo' })
    await expect(renameProject('project-1', 'renamed')).resolves.toMatchObject({
      id: 'project-1',
      name: 'renamed',
    })
    await expect(deleteProject('project-1')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-1',
      expect.objectContaining({ method: 'PATCH', credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/projects/project-1',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
  })

  it('maps duplicate names to a safe actionable conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'PROJECT_EXISTS', message: 'private' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(createProject('demo')).rejects.toMatchObject({
      message: 'A project with this name already exists.',
      status: 409,
      code: 'PROJECT_EXISTS',
    })
  })
})
