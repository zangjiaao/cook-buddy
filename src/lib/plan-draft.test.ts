import { describe, expect, test, vi } from "vitest"
import { generatePlanDraftWithAi } from "@/lib/ai/plan-draft.server"
import { isAiEnabled } from "@/lib/ai/deepseek"
import { normalizePlanEntry } from "@/lib/cook-complete"
import {
  addDraftDish,
  buildPlanDraftInput,
  buildPlanDraftWrites,
  fillDraftDay,
  heuristicPlanDraft,
  mergeAiPlanDraft,
  normalizePlanDraftInput,
  occupiedDatesFromEntries,
  planDraftHasProposals,
  planDraftWriteNeedsConfirm,
  removeDraftDish,
  replaceDatesInDraft,
  resolvePlanDraftDays,
  sanitizePlanDraftDays,
  setDraftDishServings,
  soonIngredientIdsFromInventory,
  swapDraftDish,
  toPlanDraftRecipes,
  tryParsePlanDraftJson,
} from "@/lib/plan-draft"
import type { PlanDraftInput, PlanDraftRecipe } from "@/lib/plan-draft"
import type { InventoryItem, PlanEntry, Recipe, RecipeItem } from "@/lib/types"

const today = "2026-09-18"

const stirfry: PlanDraftRecipe = {
  id: "rec-stirfry",
  name: "小白菜炒肉",
  servings: 2,
  favorited: true,
  tags: ["hun"],
  ingredientIds: ["ing-pork", "ing-bokchoy"],
}

const soup: PlanDraftRecipe = {
  id: "rec-soup",
  name: "豆腐粉丝汤",
  servings: 2,
  favorited: false,
  tags: ["su", "tang"],
  ingredientIds: ["ing-tofu"],
}

const rice: PlanDraftRecipe = {
  id: "rec-rice",
  name: "蛋炒饭",
  servings: 1,
  favorited: true,
  tags: ["zhushi"],
  ingredientIds: ["ing-egg"],
}

const salad: PlanDraftRecipe = {
  id: "rec-salad",
  name: "拍黄瓜",
  servings: 2,
  favorited: false,
  tags: ["su"],
  ingredientIds: ["ing-cucumber"],
}

function input(partial: Partial<PlanDraftInput> = {}): PlanDraftInput {
  return {
    days: ["2026-09-18", "2026-09-19", "2026-09-20"],
    recipes: [stirfry, soup],
    soonIngredientIds: ["ing-bokchoy"],
    occupiedDates: [],
    fillStrategy: "empty",
    dishesPerDay: 2,
    ...partial,
  }
}

function entry(
  partial: Pick<PlanEntry, "id" | "date" | "recipeId"> & Partial<PlanEntry>
): PlanEntry {
  return normalizePlanEntry({
    rangeKey: null,
    servings: 2,
    sortOrder: 0,
    ...partial,
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function completionResponse(content: string, status = 200): Response {
  return jsonResponse({ choices: [{ message: { content } }] }, status)
}

describe("catalog helpers", () => {
  test("临期库存抽出 ingredientId，忽略过期和新鲜", () => {
    const inventory = [
      { ingredientId: "ing-bokchoy", expiresAt: "2026-09-19" },
      { ingredientId: "ing-cilantro", expiresAt: "2026-09-10" },
      { ingredientId: "ing-soy", expiresAt: "2026-12-01" },
      { ingredientId: "ing-garlic", expiresAt: null },
    ] as InventoryItem[]
    expect(soonIngredientIdsFromInventory(inventory, today)).toEqual([
      "ing-bokchoy",
    ])
  })

  test("食谱目录带标签、常做和用料，不收未关联食材", () => {
    const recipes = [
      {
        id: "rec-stirfry",
        name: "小白菜炒肉",
        servings: 2,
        favorited: true,
        tags: ["hun", "川菜"],
      },
    ] as Recipe[]
    const items = [
      { recipeId: "rec-stirfry", ingredientId: "ing-bokchoy" },
      { recipeId: "rec-stirfry", ingredientId: null },
    ] as RecipeItem[]
    expect(toPlanDraftRecipes(recipes, items)).toEqual([
      {
        id: "rec-stirfry",
        name: "小白菜炒肉",
        servings: 2,
        favorited: true,
        tags: ["hun"],
        ingredientIds: ["ing-bokchoy"],
      },
    ])
  })

  test("占用日只看窗口里已有条目的日期", () => {
    expect(
      occupiedDatesFromEntries(
        [
          entry({ id: "a", date: "2026-09-18", recipeId: "rec-stirfry" }),
          entry({ id: "b", date: "2026-09-22", recipeId: "rec-soup" }),
        ],
        ["2026-09-18", "2026-09-19"]
      )
    ).toEqual(["2026-09-18"])
  })
})

describe("resolvePlanDraftDays", () => {
  test("当前窗口跟计划天数走", () => {
    expect(
      resolvePlanDraftDays({
        today,
        range: { type: "horizon" },
        horizonEnd: "2026-09-20",
      })
    ).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"])
  })

  test("自选 N 天从今天起算，不超过上限", () => {
    expect(
      resolvePlanDraftDays({
        today,
        range: { type: "days", days: 5 },
      })
    ).toHaveLength(5)
    expect(
      resolvePlanDraftDays({
        today,
        range: { type: "days", days: 99 },
        maxDays: 7,
      })
    ).toHaveLength(7)
  })
})

describe("heuristicPlanDraft", () => {
  test("含临期食材的菜排到更靠前的日子", () => {
    const draft = heuristicPlanDraft(
      input({
        recipes: [soup, stirfry],
        soonIngredientIds: ["ing-bokchoy"],
        dishesPerDay: 1,
      })
    )
    expect(draft.source).toBe("heuristic")
    expect(draft.days[0]?.dishes[0]?.recipeId).toBe("rec-stirfry")
    expect(draft.days[0]?.dishes[0]?.reasons).toContain("soon")
  })

  test("没有临期时优先常做", () => {
    const draft = heuristicPlanDraft(
      input({
        recipes: [salad, rice],
        soonIngredientIds: [],
        dishesPerDay: 1,
      })
    )
    expect(draft.days[0]?.dishes[0]?.recipeId).toBe("rec-rice")
    expect(draft.days[0]?.dishes[0]?.reasons).toContain("favorite")
  })

  test("同一天尽量荤素搭配，只从已有食谱里挑", () => {
    const draft = heuristicPlanDraft(
      input({
        recipes: [stirfry, soup, rice],
        dishesPerDay: 2,
      })
    )
    const firstDay = draft.days[0]?.dishes.map((dish) => dish.recipeId) ?? []
    expect(firstDay).toContain("rec-stirfry")
    expect(firstDay.some((id) => id === "rec-soup" || id === "rec-rice")).toBe(
      true
    )
    expect(
      firstDay.every((id) =>
        ["rec-stirfry", "rec-soup", "rec-rice"].includes(id)
      )
    ).toBe(true)
  })

  test("empty 策略跳过已有菜的日子", () => {
    const draft = heuristicPlanDraft(
      input({
        occupiedDates: ["2026-09-18"],
        fillStrategy: "empty",
      })
    )
    expect(draft.days[0]).toMatchObject({
      date: "2026-09-18",
      dishes: [],
      skippedReason: "occupied",
    })
    expect(draft.days[1]?.dishes.length).toBeGreaterThan(0)
    expect(draft.notes.some((note) => note.includes("先不动"))).toBe(true)
  })

  test("replace 策略也会给已占用的日子排菜", () => {
    const draft = heuristicPlanDraft(
      input({
        occupiedDates: ["2026-09-18"],
        fillStrategy: "replace",
      })
    )
    expect(draft.days[0]?.skippedReason).toBeUndefined()
    expect(draft.days[0]?.dishes.length).toBeGreaterThan(0)
  })

  test("没有食谱就不发明菜，并给出说明", () => {
    const draft = heuristicPlanDraft(input({ recipes: [] }))
    expect(draft.days.every((day) => day.dishes.length === 0)).toBe(true)
    expect(draft.notes[0]).toContain("还没有食谱")
    expect(planDraftHasProposals(draft)).toBe(false)
  })
})

describe("sanitize / merge AI days", () => {
  test("empty 策略时 AI 也不能往已有日子塞菜", () => {
    const days = sanitizePlanDraftDays(
      [{ date: "2026-09-18", recipeIds: ["rec-soup"] }],
      input({ occupiedDates: ["2026-09-18"], fillStrategy: "empty" })
    )
    expect(days?.[0]).toMatchObject({
      date: "2026-09-18",
      dishes: [],
      skippedReason: "occupied",
    })
  })

  test("丢掉未知食谱 id 和窗口外日期", () => {
    const days = sanitizePlanDraftDays(
      [
        {
          date: "2026-09-18",
          recipeIds: ["rec-stirfry", "rec-alien", "rec-stirfry"],
        },
        { date: "2026-01-01", recipeIds: ["rec-soup"] },
      ],
      input()
    )
    expect(days?.[0]?.dishes.map((dish) => dish.recipeId)).toEqual([
      "rec-stirfry",
    ])
    expect(days?.some((day) => day.date === "2026-01-01")).toBe(false)
  })

  test("AI 某天无效时用规则补上", () => {
    const fallback = heuristicPlanDraft(input({ dishesPerDay: 1 }))
    const merged = mergeAiPlanDraft(
      [
        {
          date: "2026-09-18",
          dishes: [{ recipeId: "rec-soup", servings: 3, reasons: ["tag"] }],
        },
      ],
      input({ dishesPerDay: 1 }),
      fallback
    )
    expect(merged.source).toBe("ai")
    expect(merged.days[0]?.dishes[0]).toMatchObject({
      recipeId: "rec-soup",
      servings: 3,
    })
    expect(merged.days[1]?.dishes.length).toBeGreaterThan(0)
  })

  test("tryParse 吃掉坏 JSON，围栏 JSON 能读", () => {
    expect(tryParsePlanDraftJson("不是对象", input())).toBeNull()
    const parsed = tryParsePlanDraftJson(
      '```json\n{"days":[{"date":"2026-09-18","recipeIds":["rec-soup"]}]}\n```',
      input()
    )
    expect(parsed?.[0]?.dishes[0]?.recipeId).toBe("rec-soup")
  })
})

describe("draft edits and writes", () => {
  test("去掉 / 换掉 / 加一道 / 改份数", () => {
    let draft = heuristicPlanDraft(
      input({ days: ["2026-09-18"], dishesPerDay: 1 })
    )
    expect(draft.days[0]?.dishes[0]?.recipeId).toBe("rec-stirfry")
    draft = addDraftDish(draft, "2026-09-18", soup)
    expect(draft.days[0]?.dishes.map((dish) => dish.recipeId)).toEqual([
      "rec-stirfry",
      "rec-soup",
    ])
    draft = swapDraftDish(draft, "2026-09-18", "rec-soup", rice)
    expect(draft.days[0]?.dishes.map((dish) => dish.recipeId)).toEqual([
      "rec-stirfry",
      "rec-rice",
    ])
    draft = setDraftDishServings(draft, "2026-09-18", "rec-rice", 4)
    expect(draft.days[0]?.dishes[1]?.servings).toBe(4)
    draft = removeDraftDish(draft, "2026-09-18", "rec-stirfry")
    expect(draft.days[0]?.dishes.map((dish) => dish.recipeId)).toEqual([
      "rec-rice",
    ])
  })

  test("给已占用的空天补菜", () => {
    const base = heuristicPlanDraft(
      input({ occupiedDates: ["2026-09-18"], fillStrategy: "empty" })
    )
    const filled = fillDraftDay(base, "2026-09-18", input())
    expect(filled.days[0]?.dishes.length).toBeGreaterThan(0)
    expect(filled.days[0]?.skippedReason).toBeUndefined()
    expect(replaceDatesInDraft(filled, ["2026-09-18"])).toEqual(["2026-09-18"])
  })

  test("empty 写入不删已有条目，只填空天", () => {
    const existing = [
      entry({ id: "keep-today", date: "2026-09-18", recipeId: "rec-rice" }),
    ]
    const draft = heuristicPlanDraft(
      input({ occupiedDates: ["2026-09-18"], fillStrategy: "empty" })
    )
    const write = buildPlanDraftWrites({ existing, draft })
    expect(write.removeIds).toEqual([])
    expect(write.adds.every((add) => add.date !== "2026-09-18")).toBe(true)
    expect(write.adds.length).toBeGreaterThan(0)
    expect(planDraftWriteNeedsConfirm(draft, ["2026-09-18"])).toBe(false)
  })

  test("replace 只拿掉还没做的，做过的留下", () => {
    const existing = [
      entry({
        id: "cooked",
        date: "2026-09-18",
        recipeId: "rec-rice",
        status: "cooked",
        cookedAt: "2026-09-18T10:00:00.000Z",
      }),
      entry({ id: "planned", date: "2026-09-18", recipeId: "rec-salad" }),
    ]
    const draft = heuristicPlanDraft(
      input({
        days: ["2026-09-18"],
        occupiedDates: ["2026-09-18"],
        fillStrategy: "replace",
        dishesPerDay: 1,
      })
    )
    const write = buildPlanDraftWrites({ existing, draft })
    expect(write.removeIds).toEqual(["planned"])
    expect(write.adds[0]).toMatchObject({
      date: "2026-09-18",
      recipeId: "rec-stirfry",
      sortOrder: 1,
    })
  })

  test("空策略下用户手动给占用日加菜，写入前需要确认", () => {
    const draft = fillDraftDay(
      heuristicPlanDraft(
        input({ occupiedDates: ["2026-09-18"], fillStrategy: "empty" })
      ),
      "2026-09-18",
      input()
    )
    expect(planDraftWriteNeedsConfirm(draft, ["2026-09-18"])).toBe(true)
    const write = buildPlanDraftWrites({
      existing: [
        entry({ id: "old", date: "2026-09-18", recipeId: "rec-rice" }),
      ],
      draft,
      replaceDates: ["2026-09-18"],
    })
    expect(write.removeIds).toEqual(["old"])
    expect(write.adds[0]?.date).toBe("2026-09-18")
  })
})

describe("normalizePlanDraftInput", () => {
  test("清洗坏字段，缺策略当 empty", () => {
    const normalized = normalizePlanDraftInput({
      days: ["2026-09-18", "nope", "2026-09-18"],
      recipes: [
        {
          id: "rec-stirfry",
          name: "小白菜炒肉",
          favorited: true,
          tags: ["hun"],
        },
        { id: "", name: "幽灵" },
      ],
      soonIngredientIds: ["ing-bokchoy", ""],
      occupiedDates: ["2026-09-18", "2026-12-01"],
      dishesPerDay: 9,
    })
    expect(normalized).toMatchObject({
      days: ["2026-09-18"],
      fillStrategy: "empty",
      dishesPerDay: 4,
      soonIngredientIds: ["ing-bokchoy"],
      occupiedDates: ["2026-09-18"],
    })
    expect(normalized?.recipes).toHaveLength(1)
    expect(normalizePlanDraftInput({ recipes: [] })).toBeNull()
  })

  test("buildPlanDraftInput 组装窗口、临期和占用日", () => {
    const built = buildPlanDraftInput({
      today,
      range: { type: "days", days: 3 },
      recipes: [
        {
          id: "rec-stirfry",
          name: "小白菜炒肉",
          servings: 2,
          approxMinutes: 20,
          steps: [],
          createdAt: today,
          updatedAt: today,
          favorited: true,
          tags: ["hun"],
        },
      ],
      recipeItems: [
        {
          id: "ri-1",
          recipeId: "rec-stirfry",
          ingredientId: "ing-bokchoy",
          rawName: "小白菜",
          quantity: 1,
          unit: "把",
          matchStatus: "linked",
        },
      ],
      inventory: [
        {
          id: "inv-1",
          ingredientId: "ing-bokchoy",
          quantity: 1,
          unit: "把",
          location: "fridge",
          purchasedAt: today,
          expiresAt: "2026-09-19",
          notes: "",
          createdAt: today,
          updatedAt: today,
        },
      ],
      entries: [
        entry({ id: "keep", date: "2026-09-18", recipeId: "rec-stirfry" }),
      ],
    })
    expect(built.days).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"])
    expect(built.soonIngredientIds).toEqual(["ing-bokchoy"])
    expect(built.occupiedDates).toEqual(["2026-09-18"])
    expect(built.fillStrategy).toBe("empty")
  })
})

describe("generatePlanDraftWithAi", () => {
  test("没有 key 不打 fetch，走规则草稿", async () => {
    const fetchFn = vi.fn()
    const draft = await generatePlanDraftWithAi(input(), {
      env: {},
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(draft.source).toBe("heuristic")
    expect(draft.days[0]?.dishes[0]?.recipeId).toBe("rec-stirfry")
    expect(isAiEnabled({})).toBe(false)
  })

  test("空 key 视为关闭", async () => {
    const fetchFn = vi.fn()
    const draft = await generatePlanDraftWithAi(input(), {
      env: { DEEPSEEK_API_KEY: "   " },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(draft.source).toBe("heuristic")
  })

  test("成功时用 mock fetch 的 JSON，不打真实 API", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      completionResponse(
        JSON.stringify({
          days: [{ date: "2026-09-18", recipeIds: ["rec-soup"] }],
        })
      )
    )
    const draft = await generatePlanDraftWithAi(input({ dishesPerDay: 1 }), {
      env: {
        DEEPSEEK_API_KEY: "sk-test-only",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_MODEL: "deepseek-chat",
      },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(draft.source).toBe("ai")
    expect(draft.days[0]?.dishes[0]?.recipeId).toBe("rec-soup")
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.deepseek.com/chat/completions")
    const body = JSON.parse(String(init.body)) as {
      response_format: { type: string }
    }
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  test("AI 发明的 id 丢掉，坏 JSON / HTTP 失败退回规则层", async () => {
    const invented = await generatePlanDraftWithAi(input({ dishesPerDay: 1 }), {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: vi.fn().mockResolvedValue(
        completionResponse(
          JSON.stringify({
            days: [{ date: "2026-09-18", recipeIds: ["rec-from-nowhere"] }],
          })
        )
      ) as typeof fetch,
    })
    expect(invented.days[0]?.dishes[0]?.recipeId).not.toBe("rec-from-nowhere")
    expect(invented.days[0]?.dishes[0]?.recipeId).toBe("rec-stirfry")

    const badJson = await generatePlanDraftWithAi(input(), {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: vi
        .fn()
        .mockResolvedValue(completionResponse("不是对象")) as typeof fetch,
    })
    expect(badJson.source).toBe("heuristic")

    const httpFail = await generatePlanDraftWithAi(input(), {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "no" }, 500)) as typeof fetch,
    })
    expect(httpFail.source).toBe("heuristic")
  })
})
