import { describe, expect, test, vi } from "vitest"
import { isAiEnabled } from "@/lib/ai/deepseek"
import {
  applyConfirmChoice,
  fallbackCreateDraft,
  findExactIngredient,
  guessCategory,
  guessDefaultLocation,
  guessDefaultUnit,
  resolveIngredientsLocal,
  tryParseResolveResultsJson,
} from "@/lib/ai/resolve-ingredients"
import type {
  IngredientSnapshot,
  ResolveIngredientsInput,
} from "@/lib/ai/resolve-ingredients"
import { resolveIngredientsWithAi } from "@/lib/ai/resolve-ingredients.server"

const pork: IngredientSnapshot = {
  id: "ing-pork",
  name: "五花肉",
  aliases: ["猪肉", "肥肉"],
  category: "meat",
  defaultUnit: "斤",
  stallHint: "meat",
  defaultShelfLifeDays: 4,
  family: "猪肉",
}

const scallion: IngredientSnapshot = {
  id: "ing-scallion",
  name: "小葱",
  aliases: ["青葱"],
  category: "veg",
  defaultUnit: "把",
  stallHint: "veg",
  defaultShelfLifeDays: 3,
}

const soy: IngredientSnapshot = {
  id: "ing-soy",
  name: "酱油",
  aliases: [],
  category: "seasoning",
  defaultUnit: "瓶",
  stallHint: null,
  defaultShelfLifeDays: 180,
}

const ingredients = [pork, scallion, soy]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function completionResponse(content: string, status = 200): Response {
  return jsonResponse({ choices: [{ message: { content } }] }, status)
}

describe("规则层：精确名/别名/已有 id", () => {
  test("精确名或别名直接 link，大类不算别名", () => {
    const results = resolveIngredientsLocal({
      items: [{ rawName: "五花肉" }, { rawName: "肥肉" }, { rawName: "猪肉" }],
      ingredients,
    })
    expect(results[0]).toMatchObject({
      rawName: "五花肉",
      action: "link",
      ingredientId: "ing-pork",
      source: "rule",
    })
    expect(results[1]).toMatchObject({
      rawName: "肥肉",
      action: "link",
      ingredientId: "ing-pork",
      source: "rule",
    })
    expect(results[2]).toMatchObject({
      action: "create",
      createDraft: { name: "猪肉", family: "猪肉" },
    })
  })

  test("已有 ingredientId 原样保留", () => {
    expect(
      resolveIngredientsLocal({
        items: [{ rawName: "葱", ingredientId: "ing-pork" }],
        ingredients,
      })
    ).toEqual([
      {
        rawName: "葱",
        action: "link",
        ingredientId: "ing-pork",
        source: "rule",
      },
    ])
  })

  test("对不上则准备自动创建，不留 unlinked", () => {
    const [result] = resolveIngredientsLocal({
      items: [{ rawName: "未知菜", unit: "把" }],
      ingredients,
    })
    expect(result.action).toBe("create")
    expect(result.source).toBe("fallback")
    expect(result.createDraft).toMatchObject({
      name: "未知菜",
      defaultUnit: "把",
      category: "veg",
    })
    expect(result.ingredientId).toBeUndefined()
  })

  test("findExactIngredient 认别名，但不认大类", () => {
    expect(findExactIngredient("肥肉", ingredients)?.id).toBe("ing-pork")
    expect(findExactIngredient("猪肉", ingredients)).toBeUndefined()
    expect(findExactIngredient("葱", ingredients)).toBeUndefined()
  })
})

describe("无 AI 时的创建默认值", () => {
  test("按生名猜分类、单位、位置、保质期", () => {
    expect(guessCategory("五花肉")).toBe("meat")
    expect(guessCategory("生抽")).toBe("seasoning")
    expect(guessCategory("粉丝")).toBe("dry")
    expect(guessCategory("小白菜")).toBe("veg")
    expect(guessDefaultLocation("meat")).toBe("fridge")
    expect(guessDefaultLocation("seasoning")).toBe("pantry")
    expect(guessDefaultUnit("生抽", "seasoning")).toBe("瓶")
    expect(fallbackCreateDraft("生抽")).toMatchObject({
      name: "生抽",
      category: "seasoning",
      defaultUnit: "瓶",
      stallHint: null,
      defaultLocation: "pantry",
      kind: "staple",
      purchaseUnit: "瓶",
    })
    expect(fallbackCreateDraft("生抽", "勺")).toMatchObject({
      kind: "staple",
      purchaseUnit: "瓶",
      defaultUnit: "瓶",
    })
    expect(fallbackCreateDraft("小白菜", "把")).toMatchObject({
      kind: "fresh",
      purchaseUnit: "把",
      defaultUnit: "把",
    })
    expect(fallbackCreateDraft("盐", "把")).toMatchObject({
      defaultUnit: "袋",
      purchaseUnit: "袋",
    })
    expect(fallbackCreateDraft("老抽", "把")).toMatchObject({
      defaultUnit: "瓶",
      purchaseUnit: "瓶",
    })
    expect(fallbackCreateDraft("牛腩", "把")).toMatchObject({
      defaultUnit: "斤",
      purchaseUnit: "斤",
      family: "牛肉",
    })
    expect(fallbackCreateDraft("西红柿", "把")).toMatchObject({
      defaultUnit: "个",
      purchaseUnit: "个",
    })
    expect(fallbackCreateDraft("黑鱼")).toMatchObject({
      defaultUnit: "斤",
      purchaseUnit: "斤",
      family: "鱼",
    })
  })
})

describe("resolveIngredientsWithAi", () => {
  const input: ResolveIngredientsInput = {
    items: [
      { rawName: "五花肉" },
      { rawName: "葱", unit: "把" },
      { rawName: "生抽", unit: "勺" },
    ],
    ingredients,
  }

  test("没有 key 不打 fetch，未知名自动创建", async () => {
    const fetchFn = vi.fn()
    const results = await resolveIngredientsWithAi(input, {
      env: {},
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(isAiEnabled({})).toBe(false)
    expect(results[0]).toMatchObject({
      action: "link",
      ingredientId: "ing-pork",
      source: "rule",
    })
    expect(results[1]).toMatchObject({
      action: "create",
      source: "fallback",
      createDraft: { name: "葱" },
    })
    expect(results[2]).toMatchObject({
      action: "create",
      source: "fallback",
      createDraft: { name: "生抽" },
    })
  })

  test("全部精确匹配时即使有 key 也不打 AI", async () => {
    const fetchFn = vi.fn()
    const results = await resolveIngredientsWithAi(
      { items: [{ rawName: "肥肉" }], ingredients },
      {
        env: { DEEPSEEK_API_KEY: "sk-test" },
        fetchFn: fetchFn as typeof fetch,
      }
    )
    expect(fetchFn).not.toHaveBeenCalled()
    expect(results[0]?.source).toBe("rule")
  })

  test("成功时用 mock fetch 的 JSON，不打真实 API", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      completionResponse(
        JSON.stringify({
          results: [
            {
              rawName: "葱",
              action: "link",
              ingredientId: "ing-scallion",
            },
            {
              rawName: "生抽",
              action: "needs_confirm",
              createDraft: {
                name: "生抽",
                aliases: [],
                category: "seasoning",
                defaultUnit: "瓶",
                stallHint: null,
                defaultShelfLifeDays: 180,
                defaultLocation: "pantry",
              },
              candidates: [
                {
                  ingredientId: "ing-soy",
                  name: "酱油",
                  reason: "不一定是同一种",
                },
              ],
            },
          ],
        })
      )
    )
    const results = await resolveIngredientsWithAi(input, {
      env: {
        DEEPSEEK_API_KEY: "sk-test-only",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_MODEL: "deepseek-chat",
      },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(results[0]).toMatchObject({
      action: "link",
      ingredientId: "ing-pork",
      source: "rule",
    })
    expect(results[1]).toMatchObject({
      action: "link",
      ingredientId: "ing-scallion",
      source: "ai",
    })
    expect(results[2]).toMatchObject({
      action: "needs_confirm",
      source: "ai",
      candidates: [{ ingredientId: "ing-soy", name: "酱油" }],
    })
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sk-test-only")
    const body = JSON.parse(String(init.body)) as {
      model: string
      response_format: { type: string }
    }
    expect(body.model).toBe("deepseek-chat")
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  test("坏 JSON / HTTP 失败退回自动创建", async () => {
    const badJson = await resolveIngredientsWithAi(
      { items: [{ rawName: "未知菜" }], ingredients },
      {
        env: { DEEPSEEK_API_KEY: "sk-test" },
        fetchFn: vi
          .fn()
          .mockResolvedValue(completionResponse("不是对象")) as typeof fetch,
      }
    )
    expect(badJson[0]).toMatchObject({
      action: "create",
      source: "fallback",
      createDraft: { name: "未知菜" },
    })

    const httpFail = await resolveIngredientsWithAi(
      { items: [{ rawName: "未知菜" }], ingredients },
      {
        env: { DEEPSEEK_API_KEY: "sk-test" },
        fetchFn: vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ error: "no" }, 500)
          ) as typeof fetch,
      }
    )
    expect(httpFail[0]?.action).toBe("create")
  })

  test("AI 乱 link 不存在的 id 则改成创建", () => {
    const merged = tryParseResolveResultsJson(
      JSON.stringify({
        results: [
          { rawName: "未知菜", action: "link", ingredientId: "ing-missing" },
        ],
      }),
      { items: [{ rawName: "未知菜" }], ingredients },
      resolveIngredientsLocal({ items: [{ rawName: "未知菜" }], ingredients })
    )
    expect(merged?.[0]).toMatchObject({
      action: "create",
      source: "fallback",
    })
  })
})

describe("同义词和部位", () => {
  test("番茄自动链接到西红柿，不问人", () => {
    const tomato: IngredientSnapshot = {
      id: "ing-tomato",
      name: "西红柿",
      aliases: [],
      category: "veg",
      defaultUnit: "个",
      stallHint: "veg",
      defaultShelfLifeDays: 5,
    }
    const [result] = resolveIngredientsLocal({
      items: [{ rawName: "番茄" }],
      ingredients: [tomato],
    })
    expect(result).toMatchObject({
      action: "link",
      ingredientId: "ing-tomato",
      source: "rule",
    })
  })

  test("水不创建食材", () => {
    const [result] = resolveIngredientsLocal({
      items: [{ rawName: "清水" }],
      ingredients,
    })
    expect(result.action).toBe("skip")
  })

  test("AI 把牛肉并到牛腩时改回新建", () => {
    const brisket: IngredientSnapshot = {
      id: "ing-brisket",
      name: "牛腩",
      aliases: [],
      category: "meat",
      defaultUnit: "斤",
      stallHint: "meat",
      defaultShelfLifeDays: 3,
      family: "牛肉",
    }
    const merged = tryParseResolveResultsJson(
      JSON.stringify({
        results: [
          { rawName: "牛肉", action: "link", ingredientId: "ing-brisket" },
        ],
      }),
      { items: [{ rawName: "牛肉" }], ingredients: [brisket] },
      resolveIngredientsLocal({
        items: [{ rawName: "牛肉" }],
        ingredients: [brisket],
      })
    )
    expect(merged?.[0]).toMatchObject({
      action: "create",
      createDraft: { name: "牛肉", family: "牛肉" },
    })
  })
})

describe("歧义确认", () => {
  test("人选候选或接受创建", () => {
    const pending = {
      rawName: "生抽",
      action: "needs_confirm" as const,
      source: "ai" as const,
      createDraft: fallbackCreateDraft("生抽"),
      candidates: [{ ingredientId: "ing-soy", name: "酱油" }],
    }
    expect(
      applyConfirmChoice(pending, { action: "link", ingredientId: "ing-soy" })
    ).toMatchObject({
      action: "link",
      ingredientId: "ing-soy",
    })
    expect(applyConfirmChoice(pending, { action: "create" }).action).toBe(
      "create"
    )
  })
})
