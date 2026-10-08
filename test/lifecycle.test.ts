import { expect, test } from "bun:test"
import { COMPLETION_HISTORY_LIMIT, createLifecycle } from "../src/lifecycle"

test("completion history retains recent IDs and evicts the oldest at the cap", async () => {
  let clears = 0
  const lifecycle = createLifecycle(0, () => true, async () => {}, () => { clears++ })
  for (let i = 0; i <= COMPLETION_HISTORY_LIMIT; i++) lifecycle.succeeded(String(i), "current")
  expect(clears).toBe(COMPLETION_HISTORY_LIMIT + 1)
  lifecycle.succeeded("1", "current")
  lifecycle.succeeded(String(COMPLETION_HISTORY_LIMIT), "current")
  expect(clears).toBe(COMPLETION_HISTORY_LIMIT + 1)
  lifecycle.succeeded("0", "current")
  expect(clears).toBe(COMPLETION_HISTORY_LIMIT + 2)
  lifecycle.dispose()
})

test("completion dedupe includes out-of-order repeats and ignores other sessions", async () => {
  const calls: string[] = []
  const lifecycle = createLifecycle(0, (id) => id === "current", async (id) => { calls.push(id) }, () => {})
  lifecycle.succeeded("a", "other")
  lifecycle.succeeded("a", "current")
  await Bun.sleep(10)
  lifecycle.succeeded("b", "current")
  await Bun.sleep(10)
  lifecycle.succeeded("a", "current")
  await Bun.sleep(10)
  expect(calls).toEqual(["current", "current"])
  lifecycle.dispose()
})

test("finished events coalesce and repeated completion IDs do not generate again", async () => {
  let calls = 0
  const lifecycle = createLifecycle(10, () => true, async () => { calls++ }, () => {})
  try {
    lifecycle.succeeded("first", "session")
    lifecycle.succeeded("second", "session")
    lifecycle.succeeded("second", "session")
    await Bun.sleep(20)
    expect(calls).toBe(1)
    lifecycle.succeeded("first", "session")
    lifecycle.succeeded("second", "session")
    await Bun.sleep(20)
    expect(calls).toBe(1)
  } finally {
    lifecycle.dispose()
  }
})

test("cancel invalidates late responses and new completion aborts old work", async () => {
  const pending: Array<{ signal: AbortSignal; finish: () => void }> = []
  const visible: string[] = []
  const lifecycle = createLifecycle(0, () => true, async (id, signal) => {
    await new Promise<void>((finish) => pending.push({ signal, finish }))
    if (!signal.aborted) visible.push(id)
  }, () => { visible.length = 0 })
  const first = lifecycle.run("first")
  lifecycle.succeeded("new", "next")
  expect(pending[0].signal.aborted).toBe(true)
  pending[0].finish()
  await first
  await Bun.sleep(10)
  lifecycle.cancel()
  expect(pending[1].signal.aborted).toBe(true)
  pending[1].finish()
  await Bun.sleep(0)
  expect(visible).toEqual([])
  lifecycle.dispose()
})

test("navigation, typing, disable, start and unload share cancellation for pending and active work", async () => {
  let allowed = true
  let calls = 0
  let signal: AbortSignal | undefined
  let finish: (() => void) | undefined
  const lifecycle = createLifecycle(10, () => allowed, async (_id, current) => {
    calls++
    signal = current
    await new Promise<void>((resolve) => { finish = resolve })
  }, () => {})
  lifecycle.succeeded("pending", "session")
  lifecycle.cancel()
  await Bun.sleep(20)
  expect(calls).toBe(0)
  const active = lifecycle.run("session")
  lifecycle.cancel()
  expect(signal?.aborted).toBe(true)
  finish?.()
  await active
  allowed = false
  await lifecycle.run("session")
  expect(calls).toBe(1)
  allowed = true
  lifecycle.dispose()
  await lifecycle.run("session")
  lifecycle.succeeded("after", "session")
  await Bun.sleep(20)
  expect(calls).toBe(1)
})

test("input interruption aborts active and pending work without clearing a retained suggestion", async () => {
  let clears = 0
  let calls = 0
  let signal: AbortSignal | undefined
  let finish: (() => void) | undefined
  const lifecycle = createLifecycle(10, () => true, async (_id, current) => {
    calls++
    signal = current
    await new Promise<void>((resolve) => { finish = resolve })
  }, () => { clears++ })
  lifecycle.succeeded("pending", "session")
  lifecycle.interrupt()
  await Bun.sleep(20)
  expect(calls).toBe(0)
  expect(clears).toBe(1)
  const active = lifecycle.run("session")
  expect(clears).toBe(2)
  lifecycle.interrupt()
  expect(signal?.aborted).toBe(true)
  expect(clears).toBe(2)
  finish?.()
  await active
  expect(calls).toBe(1)
  lifecycle.dispose()
  expect(clears).toBe(3)
})

test("warning is shown only once per load and never after unload", () => {
  let warnings = 0
  const lifecycle = createLifecycle(0, () => true, async () => {}, () => {})
  lifecycle.warn(() => warnings++)
  lifecycle.warn(() => warnings++)
  lifecycle.dispose()
  lifecycle.warn(() => warnings++)
  expect(warnings).toBe(1)
})
