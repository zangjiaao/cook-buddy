import { describe, expect, test } from "vitest"
import {
  DEFAULT_PLAN_DRAFT_PREFS,
  parsePlanDraftPrefs,
  PLAN_DRAFT_PREFS_STORAGE_KEY,
  readPlanDraftPrefs,
  serializePlanDraftPrefs,
  writePlanDraftPrefs,
} from "@/lib/plan-draft-prefs"
import { DEFAULT_PLAN_DRAFT_PRIORITIES } from "@/lib/plan-draft"

describe("plan draft prefs", () => {
  test("没存过或坏值用默认：当前窗口、每天 2 道、只填空天、四条优先级", () => {
    expect(parsePlanDraftPrefs(null)).toEqual(DEFAULT_PLAN_DRAFT_PREFS)
    expect(parsePlanDraftPrefs("")).toEqual(DEFAULT_PLAN_DRAFT_PREFS)
    expect(parsePlanDraftPrefs("nope")).toEqual(DEFAULT_PLAN_DRAFT_PREFS)
    expect(parsePlanDraftPrefs("[]")).toEqual(DEFAULT_PLAN_DRAFT_PREFS)
    expect(DEFAULT_PLAN_DRAFT_PREFS.priorities).toEqual(
      DEFAULT_PLAN_DRAFT_PRIORITIES
    )
  })

  test("清洗天数、道数、策略和额外要求", () => {
    const parsed = parsePlanDraftPrefs(
      JSON.stringify({
        range: { type: "days", days: 5 },
        dishesPerDay: 9,
        fillStrategy: "replace",
        extraRequirements: "  少吃辣   这周多汤  ",
        priorities: ["soon", "nope", "variety", "soon"],
      })
    )
    expect(parsed).toEqual({
      range: { type: "days", days: 5 },
      dishesPerDay: 4,
      fillStrategy: "replace",
      extraRequirements: "少吃辣 这周多汤",
      priorities: ["soon", "variety"],
    })
  })

  test("非法自选天数退回当前窗口；关掉全部优先级会记住", () => {
    expect(
      parsePlanDraftPrefs(
        JSON.stringify({
          range: { type: "days", days: 4 },
          priorities: [],
        })
      )
    ).toMatchObject({
      range: { type: "horizon" },
      priorities: [],
    })
  })

  test("读写 localStorage 形态的上次规则", () => {
    const data: Record<string, string> = {}
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value
      },
    }
    expect(readPlanDraftPrefs(storage)).toEqual(DEFAULT_PLAN_DRAFT_PREFS)
    writePlanDraftPrefs(storage, {
      range: { type: "days", days: 3 },
      dishesPerDay: 1,
      fillStrategy: "empty",
      extraRequirements: "每天只一道菜",
      priorities: ["soon", "favorite"],
    })
    expect(data[PLAN_DRAFT_PREFS_STORAGE_KEY]).toBe(
      serializePlanDraftPrefs({
        range: { type: "days", days: 3 },
        dishesPerDay: 1,
        fillStrategy: "empty",
        extraRequirements: "每天只一道菜",
        priorities: ["soon", "favorite"],
      })
    )
    expect(readPlanDraftPrefs(storage)).toMatchObject({
      range: { type: "days", days: 3 },
      dishesPerDay: 1,
      extraRequirements: "每天只一道菜",
      priorities: ["soon", "favorite"],
    })
  })
})
