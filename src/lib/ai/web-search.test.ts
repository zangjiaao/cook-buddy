import { describe, expect, test, vi } from "vitest"
import { resolveSearchProvider, webSearch } from "@/lib/ai/web-search"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("webSearch", () => {
  test("两个 key 都有时用 Tavily，并映射标题、URL 和摘要", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        results: [
          {
            title: "红烧肉的做法",
            url: "https://recipes.example/hongshaorou",
            content: "五花肉 500 克，炒糖色。",
          },
          {
            title: "内网不该出现",
            url: "http://127.0.0.1/secret",
            content: "不行",
          },
        ],
      })
    )
    const result = await webSearch("红烧肉", {
      env: { TAVILY_API_KEY: "tvly-test", BRAVE_SEARCH_API_KEY: "brave-test" },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(
      resolveSearchProvider({
        TAVILY_API_KEY: "tvly-test",
        BRAVE_SEARCH_API_KEY: "brave-test",
      })?.provider
    ).toBe("tavily")
    expect(result).toEqual({
      ok: true,
      results: [
        {
          title: "红烧肉的做法",
          url: "https://recipes.example/hongshaorou",
          snippet: "五花肉 500 克，炒糖色。",
        },
      ],
    })
    const [url, init] = fetchFn.mock.calls[0]
    if (!init) throw new Error("missing init")
    expect(url).toBe("https://api.tavily.com/search")
    expect(JSON.parse(String(init.body))).toMatchObject({
      api_key: "tvly-test",
      query: "红烧肉",
    })
  })

  test("只有 Brave key 时走 Brave", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        web: {
          results: [
            {
              title: "番茄炒蛋",
              url: "https://recipes.example/egg",
              description: "番茄和鸡蛋。",
            },
          ],
        },
      })
    )
    const result = await webSearch("番茄炒蛋", {
      env: { BRAVE_SEARCH_API_KEY: "brave-test" },
      fetchFn: fetchFn as typeof fetch,
    })
    expect(result).toEqual({
      ok: true,
      results: [
        {
          title: "番茄炒蛋",
          url: "https://recipes.example/egg",
          snippet: "番茄和鸡蛋。",
        },
      ],
    })
    const [url, init] = fetchFn.mock.calls[0]
    if (!init) throw new Error("missing init")
    expect(url).toContain("https://api.search.brave.com/res/v1/web/search?q=")
    expect(
      (init.headers as Record<string, string>)["X-Subscription-Token"]
    ).toBe("brave-test")
  })

  test("没有 key 或搜索失败时不把工具结果当成功", async () => {
    const fetchFn = vi.fn()
    expect(
      await webSearch("红烧肉", { env: {}, fetchFn: fetchFn as typeof fetch })
    ).toEqual({
      ok: false,
      error: "没有配置搜索",
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(resolveSearchProvider({})).toBeNull()

    const failed = await webSearch("红烧肉", {
      env: { TAVILY_API_KEY: "tvly-test" },
      fetchFn: vi.fn(async () =>
        jsonResponse({ error: "no" }, 500)
      ),
    })
    expect(failed).toEqual({ ok: false, error: "搜索失败" })
  })
})
