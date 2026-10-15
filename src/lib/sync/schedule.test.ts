import { describe, expect, test } from "vitest"
import { syncBusy, syncQueue } from "@/lib/sync/local"
import {
  createSyncPump,
  FOREGROUND_SYNC_EVENTS,
  SYNC_PULL_INTERVAL_MS,
} from "@/lib/sync/schedule"

type Timer = { id: number; fn: () => void; ms: number }

function harness(options?: { lastStartedAt?: () => number }) {
  let now = 10_000
  let foreground = true
  let online = true
  let busy = false
  let nextId = 1
  const timers: Timer[] = []
  const calls: number[] = []
  let pending: (() => void) | null = null

  const pump = createSyncPump({
    now: () => now,
    isForeground: () => foreground,
    isOnline: () => online,
    busy: () => busy,
    lastStartedAt: options?.lastStartedAt,
    setTimer(fn, ms) {
      const id = nextId++
      timers.push({ id, fn, ms })
      return id
    },
    clearTimer(id) {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    run() {
      calls.push(now)
      return new Promise<void>((resolve) => {
        pending = resolve
      })
    },
  })

  return {
    pump,
    calls,
    timers,
    setNow(value: number) {
      now = value
    },
    setForeground(value: boolean) {
      foreground = value
    },
    setOnline(value: boolean) {
      online = value
    },
    setBusy(value: boolean) {
      busy = value
    },
    async flush() {
      await Promise.resolve()
      await Promise.resolve()
    },
    async finish() {
      const resolve = pending
      pending = null
      resolve?.()
      await Promise.resolve()
      await Promise.resolve()
    },
    fire() {
      const due = timers.splice(0, timers.length)
      for (const timer of due) timer.fn()
    },
  }
}

describe("自动同步调度", () => {
  test("打开、回到前台和 pageshow 都算前台事件", () => {
    expect([...FOREGROUND_SYNC_EVENTS]).toEqual([
      "visibilitychange",
      "focus",
      "pageshow",
    ])
  })

  test("打开时立刻同步一次，并在前台约 30 秒后再拉", async () => {
    const clock = harness()
    clock.pump.request("open")
    await clock.flush()
    expect(clock.calls).toEqual([10_000])
    await clock.finish()
    expect(clock.timers.map((timer) => timer.ms)).toEqual([
      SYNC_PULL_INTERVAL_MS,
    ])

    clock.setNow(10_000 + SYNC_PULL_INTERVAL_MS)
    clock.fire()
    await clock.flush()
    expect(clock.calls).toEqual([10_000, 40_000])
  })

  test("visibility、focus、pageshow 挤在一起只同步一次", async () => {
    const clock = harness()
    clock.pump.request("foreground")
    clock.pump.request("foreground")
    clock.pump.request("foreground")
    await clock.flush()
    expect(clock.calls).toHaveLength(1)
    await clock.finish()
    clock.setNow(10_500)
    clock.pump.request("foreground")
    await clock.flush()
    expect(clock.calls).toHaveLength(1)
  })

  test("后台不拉，回到前台立刻拉", async () => {
    const clock = harness()
    clock.pump.request("open")
    await clock.flush()
    await clock.finish()
    expect(clock.timers).toHaveLength(1)

    clock.setForeground(false)
    clock.pump.noteHidden()
    expect(clock.timers).toHaveLength(0)
    clock.setNow(50_000)
    clock.pump.request("interval")
    await clock.flush()
    expect(clock.calls).toHaveLength(1)

    clock.setForeground(true)
    clock.pump.request("foreground")
    await clock.flush()
    expect(clock.calls).toEqual([10_000, 50_000])
  })

  test("离线不拉，online 事件会拉", async () => {
    const clock = harness()
    clock.setOnline(false)
    clock.pump.request("open")
    clock.pump.request("foreground")
    clock.pump.request("interval")
    await clock.flush()
    expect(clock.calls).toHaveLength(0)

    clock.pump.request("online")
    await clock.flush()
    expect(clock.calls).toEqual([10_000])
  })

  test("正在同步时，本地修改和手动同步合并成随后的一次", async () => {
    const clock = harness()
    clock.pump.request("open")
    await clock.flush()
    clock.pump.request("edit")
    clock.pump.request("edit")
    clock.pump.request("manual")
    await clock.finish()
    expect(clock.calls).toEqual([10_000, 10_000])
  })

  test("启动同步还在队列里时，打开事件不另起一次", async () => {
    const clock = harness({ lastStartedAt: () => 9_500 })
    clock.setBusy(true)
    clock.pump.request("open")
    await clock.flush()
    expect(clock.calls).toHaveLength(0)
    expect(clock.timers.map((timer) => timer.ms)).toEqual([
      SYNC_PULL_INTERVAL_MS,
    ])
  })

  test("dispose 后不再同步，也不再预约", async () => {
    const clock = harness()
    clock.pump.request("open")
    await clock.flush()
    clock.pump.dispose()
    await clock.finish()
    expect(clock.timers).toHaveLength(0)
    clock.pump.request("foreground")
    await clock.flush()
    expect(clock.calls).toHaveLength(1)
  })
})

describe("syncQueue", () => {
  test("两次同步排队执行，不会叠在一起", async () => {
    let active = 0
    let maxActive = 0
    const run = () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          active -= 1
          resolve()
        }, 20)
      })
    }
    await Promise.all([syncQueue(run), syncQueue(run)])
    expect(maxActive).toBe(1)
    expect(syncBusy()).toBe(false)
  })
})
