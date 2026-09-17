import { describe, expect, test } from "vitest"
import {
  applyCookedState,
  canDeduct,
  canUndoDeduct,
  clearCookedState,
  isPlanEntryCooked,
  isSameDeductSnapshot,
  normalizePlanEntry,
  planEntryNeedsMigrate,
  uncookedPlanEntries,
} from "@/lib/cook-complete"
import type { DeductSnapshot, PlanEntry } from "@/lib/types"

const snapshot: DeductSnapshot = {
  at: "2026-09-16T12:00:00.000Z",
  recipeId: "rec-stirfry",
  servings: 2,
  planEntryId: "plan-today",
  changes: [
    {
      inventoryItemId: "inv-pork",
      previousQuantity: 1,
      nextQuantity: 0.6,
    },
  ],
}

function planned(partial: Partial<PlanEntry> = {}): PlanEntry {
  return normalizePlanEntry({
    id: "plan-today",
    date: "2026-09-16",
    rangeKey: null,
    recipeId: "rec-stirfry",
    servings: 2,
    sortOrder: 0,
    ...partial,
  })
}

describe("normalizePlanEntry", () => {
  test("旧数据没有字段时视为待做", () => {
    const entry = normalizePlanEntry({
      id: "plan-old",
      date: "2026-09-16",
      rangeKey: null,
      recipeId: "rec-soup",
      servings: 2,
      sortOrder: 0,
    })
    expect(entry.status).toBe("planned")
    expect(entry.cookedAt).toBeNull()
    expect(entry.lastDeduct).toBeNull()
    expect(isPlanEntryCooked(entry)).toBe(false)
  })

  test("缺字段的旧记录需要迁移", () => {
    expect(
      planEntryNeedsMigrate({
        id: "plan-old",
        date: "2026-09-16",
        rangeKey: null,
        recipeId: "rec-soup",
        servings: 2,
        sortOrder: 0,
      })
    ).toBe(true)
    expect(planEntryNeedsMigrate(planned())).toBe(false)
  })

  test("只有 cookedAt 时补成已做", () => {
    const entry = normalizePlanEntry({
      ...planned(),
      cookedAt: "2026-09-16T11:00:00.000Z",
    })
    expect(entry.status).toBe("cooked")
    expect(entry.cookedAt).toBe("2026-09-16T11:00:00.000Z")
    expect(isPlanEntryCooked(entry)).toBe(true)
  })
})

describe("做完 / 撤销状态机", () => {
  test("成功扣库存后标记已做，第二次不能再扣", () => {
    const entry = planned()
    expect(canDeduct(entry)).toBe(true)
    expect(canUndoDeduct(entry, snapshot)).toBe(false)

    const cooked = applyCookedState(entry, snapshot)
    expect(cooked.status).toBe("cooked")
    expect(cooked.cookedAt).toBe(snapshot.at)
    expect(cooked.lastDeduct).toEqual(snapshot)
    expect(canDeduct(cooked)).toBe(false)
    expect(canUndoDeduct(cooked, snapshot)).toBe(true)
  })

  test("撤销后清已做，可以再扣一次", () => {
    const cooked = applyCookedState(planned(), snapshot)
    const undone = clearCookedState(cooked)
    expect(undone.status).toBe("planned")
    expect(undone.cookedAt).toBeNull()
    expect(undone.lastDeduct).toBeNull()
    expect(canDeduct(undone)).toBe(true)
    expect(canUndoDeduct(undone, snapshot)).toBe(false)
  })

  test("已做但没有快照时不能撤销库存", () => {
    const cooked = normalizePlanEntry({
      ...planned(),
      status: "cooked",
      cookedAt: "2026-09-16T11:00:00.000Z",
      lastDeduct: null,
    })
    expect(canDeduct(cooked)).toBe(false)
    expect(canUndoDeduct(cooked)).toBe(false)
    expect(canUndoDeduct(cooked, snapshot)).toBe(true)
  })

  test("连点时状态机只允许扣一次库存", () => {
    let stock = 1
    let entry = planned()
    function deductOnce() {
      if (!canDeduct(entry)) return false
      stock = Number((stock - 0.4).toFixed(2))
      entry = applyCookedState(entry, snapshot)
      return true
    }
    expect(deductOnce()).toBe(true)
    expect(deductOnce()).toBe(false)
    expect(deductOnce()).toBe(false)
    expect(stock).toBe(0.6)
    entry = clearCookedState(entry)
    expect(deductOnce()).toBe(true)
    expect(stock).toBe(0.2)
  })

  test("同一快照才算同一次扣除", () => {
    expect(isSameDeductSnapshot(snapshot, { ...snapshot })).toBe(true)
    expect(
      isSameDeductSnapshot(snapshot, {
        ...snapshot,
        at: "2026-09-16T13:00:00.000Z",
      })
    ).toBe(false)
  })
})

describe("uncookedPlanEntries", () => {
  test("已做的条目不参与后续清单", () => {
    const cooked = applyCookedState(planned({ id: "p1" }), snapshot)
    const open = planned({ id: "p2", recipeId: "rec-soup" })
    expect(
      uncookedPlanEntries([cooked, open]).map((entry) => entry.id)
    ).toEqual(["p2"])
    expect(
      uncookedPlanEntries([clearCookedState(cooked)]).map((entry) => entry.id)
    ).toEqual(["p1"])
  })
})
