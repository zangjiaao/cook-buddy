import { describe, expect, test, vi } from "vitest"
import {
  defaultParser,
  extractJsonObject,
  fallbackParse,
  normalizeDraftItem,
  normalizeRecipeDraft,
  ruleParse,
  tryParseRecipeDraftJson,
} from "@/lib/ai/parse-recipe"
import {
  chatCompletionsUrl,
  isAiEnabled,
  parseRecipeWithAi,
} from "@/lib/ai/parse-recipe.server"

const SAMPLE = `小白菜炒肉
2人份 约20分钟

食材：
五花肉 0.4 斤
小白菜 1 把

步骤：
1. 肉切片
2. 热锅炒熟`

const AI_JSON = {
  name: "番茄炒蛋",
  servings: 3,
  approxMinutes: 15,
  items: [
    { rawName: "番茄", quantity: 2, unit: "个" },
    { rawName: "盐", quantity: 1, unit: "少许" },
  ],
  steps: ["番茄切块", "炒蛋"],
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

describe("ruleParse", () => {
  test("抽出名称、份数、食材和步骤", () => {
    const draft = ruleParse(SAMPLE)
    expect(draft.name).toBe("小白菜炒肉")
    expect(draft.servings).toBe(2)
    expect(draft.approxMinutes).toBe(20)
    expect(draft.items).toEqual([
      { rawName: "五花肉", quantity: 0.4, unit: "斤" },
      { rawName: "小白菜", quantity: 1, unit: "把" },
    ])
    expect(draft.steps).toEqual(["肉切片", "热锅炒熟"])
  })
})

describe("defaultParser / fallbackParse", () => {
  test("空内容走 mock", async () => {
    const draft = await defaultParser.parse("")
    expect(draft.source).toBe("mock")
    expect(draft.items.length).toBeGreaterThan(0)
    expect(fallbackParse("").source).toBe("mock")
  })
})

describe("extractJsonObject", () => {
  test("抽出 markdown 围栏里的对象", () => {
    expect(extractJsonObject('```json\n{"name":"蛋炒饭"}\n```')).toEqual({
      name: "蛋炒饭",
    })
  })

  test("抽出夹在前后废话里的对象", () => {
    expect(extractJsonObject('好的：{"name":"汤"} 结束')).toEqual({
      name: "汤",
    })
  })

  test("不是对象就抛错", () => {
    expect(() => extractJsonObject("not json")).toThrow()
    expect(() => extractJsonObject("[]")).toThrow()
  })
})

describe("normalizeRecipeDraft", () => {
  test("收成 RecipeDraft 并标 ai", () => {
    expect(normalizeRecipeDraft(AI_JSON, "ai")).toEqual({
      ...AI_JSON,
      source: "ai",
    })
  })

  test("少许/适量可当单位或模糊量", () => {
    expect(
      normalizeDraftItem({ rawName: "盐", quantity: "少许", unit: "克" })
    ).toEqual({ rawName: "盐", quantity: 1, unit: "少许" })
    expect(
      normalizeDraftItem({ rawName: "葱", quantity: 0, unit: "适量" })
    ).toEqual({ rawName: "葱", quantity: 1, unit: "适量" })
  })

  test("缺份数、坏分钟、ingredients 别名", () => {
    const draft = normalizeRecipeDraft(
      {
        name: "汤",
        servings: "x",
        approxMinutes: "很快",
        ingredients: [{ name: "豆腐", quantity: "2", unit: "块" }],
        steps: ["煮"],
      },
      "ai"
    )
    expect(draft).toEqual({
      name: "汤",
      servings: 2,
      approxMinutes: null,
      items: [{ rawName: "豆腐", quantity: 2, unit: "块" }],
      steps: ["煮"],
      source: "ai",
    })
  })

  test("没名字或空内容则无效", () => {
    expect(normalizeRecipeDraft({ name: "", items: [], steps: [] })).toBeNull()
    expect(
      normalizeRecipeDraft({ name: "汤", items: [], steps: [] })
    ).toBeNull()
  })

  test("tryParse 吃掉坏 JSON", () => {
    expect(tryParseRecipeDraftJson("not json")).toBeNull()
    expect(tryParseRecipeDraftJson(JSON.stringify(AI_JSON), "ai")?.source).toBe(
      "ai"
    )
  })
})

describe("parseRecipeWithAi", () => {
  test("没有 key 不打 fetch，走规则/mock", async () => {
    const fetchFn = vi.fn()
    const draft = await parseRecipeWithAi(SAMPLE, {
      env: {},
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(draft.source).toBe("rule")
    expect(isAiEnabled({})).toBe(false)
    expect(isAiEnabled({ DEEPSEEK_API_KEY: "sk-test" })).toBe(true)
  })

  test("空 key 视为关闭", async () => {
    const fetchFn = vi.fn()
    const draft = await parseRecipeWithAi("", {
      env: { DEEPSEEK_API_KEY: "   " },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(draft.source).toBe("mock")
  })

  test("成功时用 mock fetch 的 JSON，不打真实 API", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(completionResponse(JSON.stringify(AI_JSON)))
    const draft = await parseRecipeWithAi("随便贴", {
      env: {
        DEEPSEEK_API_KEY: "sk-test-only",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_MODEL: "deepseek-chat",
      },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(draft).toEqual({ ...AI_JSON, source: "ai" })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.deepseek.com/chat/completions")
    expect(init.method).toBe("POST")
    expect(String(init.headers)).not.toContain("undefined")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sk-test-only")
    const body = JSON.parse(String(init.body)) as {
      model: string
      response_format: { type: string }
    }
    expect(body.model).toBe("deepseek-chat")
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  test("坏 JSON / HTTP 失败 / 超时退回规则层", async () => {
    const badJson = await parseRecipeWithAi(SAMPLE, {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: vi
        .fn()
        .mockResolvedValue(completionResponse("不是对象")) as typeof fetch,
    })
    expect(badJson.source).toBe("rule")

    const httpFail = await parseRecipeWithAi(SAMPLE, {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "no" }, 500)) as typeof fetch,
    })
    expect(httpFail.source).toBe("rule")

    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted")
          error.name = "AbortError"
          reject(error)
        })
      })
    })
    const timedOut = await parseRecipeWithAi(SAMPLE, {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: fetchFn as typeof fetch,
      timeoutMs: 5,
    })
    expect(timedOut.source).toBe("rule")
    expect(timedOut.name).toBe("小白菜炒肉")
  })
})

describe("chatCompletionsUrl", () => {
  test("补上 /chat/completions，不重复", () => {
    expect(chatCompletionsUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/chat/completions"
    )
    expect(chatCompletionsUrl("https://api.deepseek.com/v1/")).toBe(
      "https://api.deepseek.com/v1/chat/completions"
    )
    expect(
      chatCompletionsUrl("https://api.deepseek.com/chat/completions")
    ).toBe("https://api.deepseek.com/chat/completions")
  })
})
