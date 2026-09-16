export const SHOPPING_REGEN_DEBOUNCE_MS = 280

export type ShoppingRegenScheduler = {
  schedule: () => void
  flush: () => Promise<unknown>
  force: () => Promise<unknown>
  setRegenerate: (fn: () => Promise<unknown>) => void
  setOnSettled: (fn: (() => void) | null) => void
}

type SchedulerOptions = {
  debounceMs?: number
  regenerate?: () => Promise<unknown>
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (id: unknown) => void
}

export function createAfterWrite(schedule: () => void) {
  return async function afterWrite<T>(work: Promise<T>): Promise<T> {
    const value = await work
    schedule()
    return value
  }
}

export function createShoppingRegenScheduler(
  options: SchedulerOptions = {}
): ShoppingRegenScheduler {
  const debounceMs = options.debounceMs ?? SHOPPING_REGEN_DEBOUNCE_MS
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((id: unknown) => clearTimeout(id as NodeJS.Timeout))

  let regenerate = options.regenerate ?? (async () => undefined)
  let onSettled: (() => void) | null = null
  let timer: unknown = null
  let inFlight: Promise<unknown> | null = null
  let dirty = false

  function setRegenerate(fn: () => Promise<unknown>) {
    regenerate = fn
  }

  function setOnSettled(fn: (() => void) | null) {
    onSettled = fn
  }

  function clearTimer() {
    if (timer != null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  function schedule() {
    dirty = true
    if (inFlight) return
    clearTimer()
    timer = setTimeoutFn(() => {
      timer = null
      void kick()
    }, debounceMs)
  }

  async function kick(): Promise<unknown> {
    if (inFlight) {
      dirty = true
      return inFlight
    }
    if (!dirty) return
    dirty = false
    const work = regenerate()
      .then((result) => {
        onSettled?.()
        return result
      })
      .finally(() => {
        inFlight = null
      })
      .then((result) => {
        if (dirty) return kick()
        return result
      })
    inFlight = work
    return work
  }

  async function flush() {
    clearTimer()
    if (inFlight) {
      await inFlight
      if (dirty) return kick()
      return
    }
    if (dirty) return kick()
  }

  async function force() {
    clearTimer()
    dirty = true
    if (inFlight) await inFlight
    dirty = true
    return kick()
  }

  return { schedule, flush, force, setRegenerate, setOnSettled }
}

export const shoppingRegen = createShoppingRegenScheduler()

export async function afterWriteAffectingShopping<T>(
  work: Promise<T>
): Promise<T> {
  return createAfterWrite(() => shoppingRegen.schedule())(work)
}
