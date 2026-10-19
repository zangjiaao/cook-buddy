import { afterEach, describe, expect, test, vi } from "vitest"
import { formatISODate } from "@/lib/dates"
import {
  isMissedPlanEntry,
  missedDayLabel,
  missedPlanEntries,
  missedPlanHint,
} from "@/lib/plan-missed"
import type { PlanEntry } from "@/lib/types"

function entry(
  partial: Pick<PlanEntry, "id" | "date"> & Partial<PlanEntry>
): PlanEntry {
  return {
    rangeKey: null,
    recipeId: "rec-1",
    servings: 2,
    sortOrder: 0,
    status: "planned",
    cookedAt: null,
    lastDeduct: null,
    ...partial,
  }
}

describe("missed plan entries", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("假时钟跨过本地午夜后，昨天没做的才算错过", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const dish = entry({ id: "p1", date: "2026-10-19" })
    const cooked = entry({
      id: "p2",
      date: "2026-10-19",
      status: "cooked",
      cookedAt: "2026-10-19T12:00:00.000Z",
    })

    vi.setSystemTime(new Date(2026, 9, 19, 23, 50, 0))
    const tonight = formatISODate()
    expect(isMissedPlanEntry(dish, tonight)).toBe(false)
    expect(missedPlanHint([dish, cooked], tonight)).toBeNull()

    vi.setSystemTime(new Date(2026, 9, 20, 0, 5, 0))
    const morning = formatISODate()
    expect(morning).toBe("2026-10-20")
    expect(
      missedPlanEntries([cooked, dish], morning).map((row) => row.id)
    ).toEqual(["p1"])
    expect(missedPlanHint([dish, cooked], morning)).toBe("昨天有 1 道没做")
    expect(missedDayLabel(dish.date, morning)).toBe("昨天")
  })

  test("不止昨天时，提示写成过去有几道", () => {
    const today = "2026-10-20"
    const missed = [
      entry({ id: "older", date: "2026-10-17", sortOrder: 1 }),
      entry({ id: "yesterday", date: "2026-10-19", sortOrder: 0 }),
      entry({ id: "today", date: today }),
    ]
    expect(missedPlanEntries(missed, today).map((row) => row.id)).toEqual([
      "older",
      "yesterday",
    ])
    expect(missedPlanHint(missed, today)).toBe("过去有 2 道没做")
    expect(missedDayLabel("2026-10-17", today)).toBe("10月17日")
  })
})
