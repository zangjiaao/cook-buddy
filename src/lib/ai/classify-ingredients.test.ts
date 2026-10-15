import { describe, expect, test, vi } from "vitest"
import { classifyIngredientsWithAi } from "@/lib/ai/classify-ingredients.server"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function completion(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] })
}

describe("classifyIngredientsWithAi", () => {
  test("规则能确定的不打 AI，认不出的在没 key 时归其他", async () => {
    const fetchFn = vi.fn()
    const rows = await classifyIngredientsWithAi(["五香粉", "小白菜", "可乐"], {
      env: {},
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(rows).toEqual([
      { name: "五香粉", category: "seasoning", source: "rule" },
      { name: "小白菜", category: "veg", source: "rule" },
      { name: "可乐", category: "other", source: "fallback" },
    ])
  })

  test("只把规则没覆盖的一批送给 AI，失败仍是其他", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      completion(
        JSON.stringify({
          results: [{ name: "可乐", category: "other" }],
        })
      )
    )
    const rows = await classifyIngredientsWithAi(["食用油", "可乐"], {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: fetchFn as typeof fetch,
      timeoutMs: 50,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const body = JSON.parse(
      String((fetchFn.mock.calls[0] as [string, RequestInit])[1].body)
    ) as { messages: Array<{ content: string }> }
    expect(body.messages[1]?.content).toContain("可乐")
    expect(body.messages[1]?.content).not.toContain("食用油")
    expect(rows).toEqual([
      { name: "食用油", category: "seasoning", source: "rule" },
      { name: "可乐", category: "other", source: "ai" },
    ])

    const failed = await classifyIngredientsWithAi(["可乐"], {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "no" }, 500)) as typeof fetch,
    })
    expect(failed).toEqual([
      { name: "可乐", category: "other", source: "fallback" },
    ])
  })

  test("AI 把五香粉说成蔬菜时仍以规则为准", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      completion(
        JSON.stringify({
          results: [{ name: "五香粉", category: "veg" }],
        })
      )
    )
    const rows = await classifyIngredientsWithAi(["五香粉"], {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(rows[0]).toEqual({
      name: "五香粉",
      category: "seasoning",
      source: "rule",
    })
  })
})
