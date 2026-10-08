export function createLifecycle(delay: number, allowed: (sessionID: string) => boolean, generate: (sessionID: string, signal: AbortSignal) => Promise<void>, clear: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let disposed = false
  let warned = false
  const completed = new Set<string>()
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    controller?.abort()
    controller = undefined
    clear()
  }
  const run = async (sessionID: string) => {
    cancel()
    if (disposed || !allowed(sessionID)) return
    const current = new AbortController()
    controller = current
    try {
      await generate(sessionID, current.signal)
    } finally {
      if (controller === current) controller = undefined
    }
  }
  return {
    cancel,
    run,
    succeeded(id: string, sessionID: string) {
      if (disposed || !allowed(sessionID) || completed.has(id)) return
      completed.add(id)
      if (completed.size > COMPLETION_HISTORY_LIMIT) completed.delete(completed.values().next().value!)
      cancel()
      timer = setTimeout(() => { timer = undefined; void run(sessionID) }, delay)
    },
    warn(show: () => void) {
      if (disposed || warned) return
      warned = true
      show()
    },
    dispose() { disposed = true; cancel() },
  }
}
export const COMPLETION_HISTORY_LIMIT = 1024
