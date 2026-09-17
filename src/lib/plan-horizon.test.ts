import { describe, expect, test } from "vitest"
import {
  addPlanHorizonDay,
  canCollapsePlanHorizon,
  canExtendPlanHorizon,
  collapsePlanHorizonEnd,
  DEFAULT_PLAN_HORIZON_DAYS,
  MAX_PLAN_HORIZON_DAYS,
  parseHorizonEnd,
  PLAN_HORIZON_STORAGE_KEY,
  readHorizonEnd,
  resolvePlanHorizon,
  writeHorizonEnd,
} from "@/lib/plan-horizon"

const today = "2026-09-17"

describe("parseHorizonEnd", () => {
  test("合法日期留下，坏值丢掉", () => {
    expect(parseHorizonEnd("2026-09-22")).toBe("2026-09-22")
    expect(parseHorizonEnd("2026-02-31")).toBeNull()
    expect(parseHorizonEnd("")).toBeNull()
    expect(parseHorizonEnd(null)).toBeNull()
    expect(parseHorizonEnd("nope")).toBeNull()
  })
})

describe("horizon storage", () => {
  test("读写 localStorage 形态的截止日期", () => {
    const data: Record<string, string> = {}
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value
      },
    }
    expect(readHorizonEnd(storage)).toBeNull()
    writeHorizonEnd(storage, "2026-09-22")
    expect(data[PLAN_HORIZON_STORAGE_KEY]).toBe("2026-09-22")
    expect(readHorizonEnd(storage)).toBe("2026-09-22")
  })
})

describe("resolvePlanHorizon", () => {
  test("默认是今天起连续三天", () => {
    const horizon = resolvePlanHorizon({ today })
    expect(horizon.days).toEqual(["2026-09-17", "2026-09-18", "2026-09-19"])
    expect(horizon.end).toBe("2026-09-19")
    expect(horizon.days).toHaveLength(DEFAULT_PLAN_HORIZON_DAYS)
  })

  test("记住的截止日期会拉长视窗", () => {
    expect(
      resolvePlanHorizon({ today, preferredEnd: "2026-09-22" }).days
    ).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
    ])
  })

  test("过期或比默认更短的偏好不缩短视窗", () => {
    expect(
      resolvePlanHorizon({ today, preferredEnd: "2026-09-16" }).end
    ).toBe("2026-09-19")
    expect(
      resolvePlanHorizon({ today, preferredEnd: "2026-09-18" }).end
    ).toBe("2026-09-19")
  })

  test("更远日期上已有计划时，视窗要盖住，不把菜藏起来", () => {
    const horizon = resolvePlanHorizon({
      today,
      preferredEnd: "2026-09-19",
      entryDates: ["2026-09-16", "2026-09-22", "not-a-date"],
    })
    expect(horizon.days.at(-1)).toBe("2026-09-22")
    expect(horizon.days).toContain("2026-09-21")
    expect(horizon.days).not.toContain("2026-09-16")
  })

  test("用户加天不超过上限，但已有更远计划仍会露出来", () => {
    const capped = resolvePlanHorizon({
      today,
      preferredEnd: "2027-01-01",
    })
    expect(capped.days).toHaveLength(MAX_PLAN_HORIZON_DAYS)
    expect(capped.end).toBe("2026-10-07")

    const withEntry = resolvePlanHorizon({
      today,
      preferredEnd: "2027-01-01",
      entryDates: ["2026-10-10"],
    })
    expect(withEntry.end).toBe("2026-10-10")
    expect(withEntry.days).toContain("2026-10-10")
  })
})

describe("add and collapse horizon", () => {
  test("加一天接到当前截止日期后面", () => {
    expect(addPlanHorizonDay("2026-09-19")).toBe("2026-09-20")
    expect(addPlanHorizonDay("2026-09-30")).toBe("2026-10-01")
  })

  test("到上限就不能再加", () => {
    expect(
      canExtendPlanHorizon({ today, end: "2026-10-06" })
    ).toBe(true)
    expect(
      canExtendPlanHorizon({ today, end: "2026-10-07" })
    ).toBe(false)
  })

  test("收掉后面空着的天，停在默认三天或最后有菜的那天", () => {
    expect(
      collapsePlanHorizonEnd({
        today,
        currentEnd: "2026-09-22",
        entryDates: [],
      })
    ).toBe("2026-09-19")
    expect(
      collapsePlanHorizonEnd({
        today,
        currentEnd: "2026-09-22",
        entryDates: ["2026-09-21"],
      })
    ).toBe("2026-09-21")
    expect(
      canCollapsePlanHorizon({
        today,
        currentEnd: "2026-09-19",
        entryDates: [],
      })
    ).toBe(false)
    expect(
      canCollapsePlanHorizon({
        today,
        currentEnd: "2026-09-22",
        entryDates: ["2026-09-22"],
      })
    ).toBe(false)
  })
})
