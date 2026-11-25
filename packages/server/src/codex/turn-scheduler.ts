type TurnTask = {
  id: string
  scope: string
  run: (signal: AbortSignal) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  controller: AbortController
  timer?: NodeJS.Timeout
  settled: boolean
}

/** Owns per-user Turn queues, active work, and scope serialization. */
export class TurnScheduler {
  private readonly queues = new Map<string, TurnTask[]>()
  private readonly activeTasks = new Map<string, Set<TurnTask>>()
  private readonly activeScopes = new Map<string, Set<string>>()

  activeCount(userId: string) {
    return this.activeTasks.get(userId)?.size ?? 0
  }

  enqueue(
    userId: string,
    run: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs = 120_000,
    taskId: string = crypto.randomUUID(),
    scope = '__global__',
  ) {
    return new Promise<unknown>((resolve, reject) => {
      const task: TurnTask = {
        id: taskId,
        scope,
        run,
        resolve,
        reject,
        controller: new AbortController(),
        settled: false,
      }
      task.timer = setTimeout(
        () => this.abortTask(userId, task, new Error('Turn timed out')),
        timeoutMs,
      )
      const queue = this.queues.get(userId) ?? []
      queue.push(task)
      this.queues.set(userId, queue)
      this.drain(userId)
    })
  }

  cancel(userId: string, taskId?: string) {
    const queue = this.queues.get(userId)
    const index = taskId ? (queue?.findIndex((task) => task.id === taskId) ?? -1) : 0
    const task =
      index >= 0
        ? queue?.splice(index, 1)[0]
        : [...(this.activeTasks.get(userId) ?? [])].find((value) => value.id === taskId)
    if (!task) return false
    this.abortTask(userId, task, new Error('Turn cancelled'))
    return true
  }

  rejectUser(userId: string, error: Error) {
    const queue = this.queues.get(userId) ?? []
    this.queues.delete(userId)
    for (const task of queue) this.abortTask(userId, task, error)
    for (const task of this.activeTasks.get(userId) ?? []) this.abortTask(userId, task, error)
  }

  shutdown(error: Error) {
    for (const userId of this.queues.keys()) this.rejectUser(userId, error)
  }

  private abortTask(userId: string, task: TurnTask, error: Error) {
    if (task.settled) return
    task.settled = true
    if (task.timer) clearTimeout(task.timer)
    task.controller.abort(error)
    task.reject(error)
    const active = this.activeTasks.get(userId)
    active?.delete(task)
    this.drain(userId)
  }

  private drain(userId: string) {
    const queue = this.queues.get(userId) ?? []
    while (queue.length) {
      const index = queue.findIndex((task) => !this.activeScopes.get(userId)?.has(task.scope))
      if (index < 0) break
      const task = queue.splice(index, 1)[0]
      if (task.settled) continue
      const scopes = this.activeScopes.get(userId) ?? new Set<string>()
      scopes.add(task.scope)
      this.activeScopes.set(userId, scopes)
      const activeTasks = this.activeTasks.get(userId) ?? new Set()
      activeTasks.add(task)
      this.activeTasks.set(userId, activeTasks)
      void task
        .run(task.controller.signal)
        .then(
          (value) => {
            if (!task.settled) {
              task.settled = true
              task.resolve(value)
            }
            return undefined
          },
          (error: unknown) => {
            if (!task.settled) {
              task.settled = true
              task.reject(error instanceof Error ? error : new Error(String(error)))
            }
          },
        )
        .finally(() => {
          if (task.timer) clearTimeout(task.timer)
          activeTasks.delete(task)
          const trackedScopes = this.activeScopes.get(userId)
          trackedScopes?.delete(task.scope)
          this.drain(userId)
        })
    }
  }
}
