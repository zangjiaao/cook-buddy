import { describe, expect, test } from "vitest"
import { buildShoppingFromPlan } from "@/lib/shopping-from-plan"
import {
  createAfterWrite,
  createShoppingRegenScheduler,
} from "@/lib/shopping-sync"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

type Timer = { id: number; fn: () => void; ms: number }

function createClock() {
  let nextId = 1
  const timers: Timer[] = []
  return {
    timers,
    setTimeoutFn(fn: () => void, ms: number) {
      const id = nextId++
      timers.push({ id, fn, ms })
      return id
    },
    clearTimeoutFn(id: unknown) {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    fire() {
      const due = timers.splice(0, timers.length)
      for (const timer of due) timer.fn()
    },
  }
}

describe("createAfterWrite", () => {
  test("写入成功才预约重算，失败不预约", async () => {
    const calls: string[] = []
    const afterWrite = createAfterWrite(() => {
      calls.push("schedule")
    })
    await expect(afterWrite(Promise.resolve("ok"))).resolves.toBe("ok")
    expect(calls).toEqual(["schedule"])
    await expect(afterWrite(Promise.reject(new Error("no")))).rejects.toThrow(
      "no"
    )
    expect(calls).toEqual(["schedule"])
  })
})

describe("createShoppingRegenScheduler", () => {
  test("连点份数只重算一次", async () => {
    let calls = 0
    const clock = createClock()
    const sync = createShoppingRegenScheduler({
      debounceMs: 200,
      regenerate: async () => {
        calls += 1
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    })

    sync.schedule()
    sync.schedule()
    sync.schedule()
    expect(clock.timers).toHaveLength(1)
    expect(calls).toBe(0)

    clock.fire()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(1)
  })

  test("flush 会立刻跑完待处理的重算", async () => {
    let calls = 0
    const clock = createClock()
    const sync = createShoppingRegenScheduler({
      debounceMs: 500,
      regenerate: async () => {
        calls += 1
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    })

    sync.schedule()
    expect(clock.timers).toHaveLength(1)
    await sync.flush()
    expect(calls).toBe(1)
    expect(clock.timers).toHaveLength(0)
  })

  test("进行中再预约会在结束后再跑一轮", async () => {
    let calls = 0
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const clock = createClock()
    const sync = createShoppingRegenScheduler({
      debounceMs: 50,
      regenerate: async () => {
        calls += 1
        if (calls === 1) await firstGate
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    })

    sync.schedule()
    clock.fire()
    await Promise.resolve()
    expect(calls).toBe(1)
    sync.schedule()
    const done = sync.flush()
    releaseFirst()
    await done
    expect(calls).toBe(2)
  })
})

describe("auto regen 仍保留已买勾选", () => {
  test("调度器跑同一套 buildShoppingFromPlan 合并规则", async () => {
    const tofu: Ingredient = {
      id: "ing-tofu",
      name: "豆腐",
      aliases: [],
      category: "veg",
      defaultUnit: "盒",
      stallHint: "veg",
      defaultShelfLifeDays: 4,
    }
    const recipe: Recipe = {
      id: "rec-soup",
      name: "豆腐粉丝汤",
      servings: 2,
      approxMinutes: 15,
      steps: [],
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    }
    const recipeItem: RecipeItem = {
      id: "ri-tofu",
      recipeId: "rec-soup",
      ingredientId: "ing-tofu",
      rawName: "豆腐",
      quantity: 1,
      unit: "盒",
      matchStatus: "linked",
    }
    const plan: PlanEntry = {
      id: "p1",
      date: "2026-09-16",
      rangeKey: null,
      recipeId: "rec-soup",
      servings: 2,
      sortOrder: 0,
      status: "planned",
      cookedAt: null,
      lastDeduct: null,
    }
    const existing: ShoppingItem[] = [
      {
        id: "shop-tofu",
        ingredientId: "ing-tofu",
        name: "豆腐",
        quantityHint: "1",
        unit: "盒",
        stallHint: "veg",
        status: "bought",
        shortage: "short",
        fromPlanEntryIds: ["p1"],
        checkedAt: "2026-09-16T08:00:00.000Z",
      },
    ]
    const inventory: InventoryItem[] = []

    const afterWrite = createAfterWrite(() => {
      /* mutation happened */
    })
    await afterWrite(Promise.resolve(plan))

    const next = buildShoppingFromPlan({
      planEntries: [plan],
      recipes: [recipe],
      recipeItems: [recipeItem],
      ingredients: [tofu],
      inventory,
      existing,
    })

    expect(next).toEqual([
      expect.objectContaining({
        id: "shop-tofu",
        status: "bought",
        checkedAt: "2026-09-16T08:00:00.000Z",
      }),
    ])
  })
})
