/** Foreground pull cadence. Background tabs do not arm this timer. */
export const SYNC_PULL_INTERVAL_MS = 30_000

/** visibilitychange, focus, and pageshow often arrive together, especially on iOS PWAs. */
export const SYNC_COALESCE_MS = 1_000

/** Push local edits after a short pause so typing doesn't sync on every keystroke. */
export const SYNC_EDIT_DELAY_MS = 800

export const FOREGROUND_SYNC_EVENTS = [
  "visibilitychange",
  "focus",
  "pageshow",
] as const

export type SyncReason =
  "open" | "foreground" | "online" | "interval" | "edit" | "manual"

export type SyncPump = {
  request: (reason: SyncReason) => void
  noteHidden: () => void
  dispose: () => void
}

type SyncPumpOptions = {
  run: () => Promise<unknown>
  intervalMs?: number
  coalesceMs?: number
  now?: () => number
  isForeground?: () => boolean
  isOnline?: () => boolean
  /** Another sync (startup) is already inside syncQueue. */
  busy?: () => boolean
  /** Timestamp of the latest syncQueue start, including ones this pump did not launch. */
  lastStartedAt?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

export function createSyncPump(options: SyncPumpOptions): SyncPump {
  const intervalMs = options.intervalMs ?? SYNC_PULL_INTERVAL_MS
  const coalesceMs = options.coalesceMs ?? SYNC_COALESCE_MS
  const nowFn = options.now ?? (() => Date.now())
  const isForeground = options.isForeground ?? (() => true)
  const isOnline = options.isOnline ?? (() => true)
  const busy = options.busy ?? (() => false)
  const externalStartedAt = options.lastStartedAt ?? (() => 0)
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer =
    options.clearTimer ??
    ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))

  let disposed = false
  let inFlight = false
  let followUp = false
  let lastStarted = 0
  let timer: unknown = null

  function clearArmed() {
    if (timer == null) return
    clearTimer(timer)
    timer = null
  }

  function arm() {
    if (disposed || !isForeground()) return
    clearArmed()
    timer = setTimer(() => {
      timer = null
      request("interval")
      if (!inFlight && !disposed) arm()
    }, intervalMs)
  }

  function latestStart(): number {
    return Math.max(lastStarted, externalStartedAt())
  }

  function start(now: number) {
    if (disposed || inFlight) return
    inFlight = true
    lastStarted = now
    clearArmed()
    void Promise.resolve()
      .then(() => options.run())
      .finally(() => {
        inFlight = false
        if (disposed) return
        if (followUp) {
          followUp = false
          start(nowFn())
          return
        }
        arm()
      })
  }

  function keepArmed() {
    if (!inFlight && isForeground() && timer == null) arm()
  }

  function request(reason: SyncReason) {
    if (disposed) return
    const now = nowFn()
    const foreground = isForeground()
    const online = isOnline()
    const occupied = inFlight || busy()
    const since = now - latestStart()

    if (reason === "interval") {
      if (!foreground || !online || occupied || since < intervalMs) {
        keepArmed()
        return
      }
    } else if (reason === "edit") {
      if (!online) return
      if (occupied) {
        followUp = true
        return
      }
    } else if (reason === "manual") {
      if (occupied) {
        followUp = true
        return
      }
    } else if (reason !== "online" && !online) {
      return
    } else if (occupied || since < coalesceMs) {
      keepArmed()
      return
    }

    start(now)
  }

  return {
    request,
    noteHidden() {
      clearArmed()
    },
    dispose() {
      disposed = true
      followUp = false
      clearArmed()
    },
  }
}
