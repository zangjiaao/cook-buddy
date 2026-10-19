import { describe, expect, test, vi } from "vitest"
import { fetchRecipePage } from "@/lib/ai/fetch-page"
import { RECIPE_AGENT_SYSTEM_PROMPT } from "@/lib/ai/recipe-agent-prompt"
import {
  extractHttpUrls,
  initialParseStatus,
  looksLikeFullRecipe,
} from "@/lib/ai/recipe-input"
import {
  parsePastedRecipeInput,
  pickImportedSourceUrl,
  recipeAgentTools,
} from "@/lib/ai/recipe-agent"
import type { SearchHit } from "@/lib/ai/web-search"

const ENV = {
  DEEPSEEK_API_KEY: "sk-test",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  TAVILY_API_KEY: "tvly-test",
}

const FULL = `番茄炒蛋
2人份

食材：
番茄 2 个
鸡蛋 3 个

步骤：
1. 热锅炒蛋
2. 下番茄炒出汁`

const DRAFT = {
  name: "番茄炒蛋",
  servings: 2,
  approxMinutes: 15,
  items: [
    { rawName: "番茄", quantity: 2, unit: "个" },
    { rawName: "鸡蛋", quantity: 3, unit: "个" },
  ],
  steps: ["热锅炒蛋", "下番茄炒出汁"],
}

const PAGE = "https://recipes.example/hongshaorou"

const JSON_LD = `<!doctype html><html><head>
<script type="application/ld+json">
{"@type":"Recipe","name":"红烧肉","recipeYield":"2人份","totalTime":"PT90M","recipeIngredient":["五花肉 500克"],"recipeInstructions":["肉焯水","炒糖色"]}
</script>
</head><body><nav>导航</nav></body></html>`

function chat(message: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function toolCall(name: string, args: object, id: string): Response {
  return chat({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  })
}

function jsonMessage(body: unknown): Response {
  return chat({ role: "assistant", content: JSON.stringify(body) })
}

function scripted(steps: Array<() => Response>) {
  let index = 0
  return vi.fn(async () => {
    const step = steps.at(index)
    index += 1
    if (!step) throw new Error("unexpected model call")
    return step()
  })
}

function requestBody(fetchFn: ReturnType<typeof vi.fn>, call: number) {
  const init = fetchFn.mock.calls[call]?.[1] as RequestInit
  return JSON.parse(String(init.body)) as {
    tools?: Array<{ function: { name: string } }>
    response_format?: { type: string }
    messages: Array<{ role: string; content?: string }>
  }
}

describe("recipe input", () => {
  test("分享文案里的链接、完整食谱和菜名分开认", () => {
    const shared = "看看这个 https://recipes.example/hongshaorou 好好吃"
    expect(extractHttpUrls(shared)).toEqual([PAGE])
    expect(looksLikeFullRecipe(shared)).toBe(false)
    expect(initialParseStatus(shared)).toBe("正在从链接读取…")
    expect(looksLikeFullRecipe(FULL)).toBe(true)
    expect(initialParseStatus(FULL)).toBe("正在抽出…")
    expect(looksLikeFullRecipe("帮我找个红烧肉的做法")).toBe(false)
    expect(initialParseStatus("帮我找个红烧肉的做法")).toBe("正在搜索…")
  })
})

describe("parsePastedRecipeInput", () => {
  test("完整食谱文字不调用搜索或抓取", async () => {
    const fetchFn = scripted([
      () =>
        jsonMessage({
          ...DRAFT,
          sourceUrl: "https://evil.example/invented",
        }),
    ])
    const pageFetch = vi.fn()
    const searchFn = vi.fn()
    const outcome = await parsePastedRecipeInput(FULL, {
      env: ENV,
      fetchFn: fetchFn,
      pageFetch: pageFetch as typeof fetch,
      searchFn,
    })
    expect(outcome).toEqual({ ok: true, draft: { ...DRAFT, source: "ai" } })
    expect(pageFetch).not.toHaveBeenCalled()
    expect(searchFn).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const body = requestBody(fetchFn, 0)
    expect(body.tools?.map((tool) => tool.function.name)).toEqual([
      "web_search",
      "fetch_page",
    ])
    expect(body.response_format).toBeUndefined()
    expect(body.messages[0]?.content).toContain("不要调用任何工具")
  })

  test("链接先抓页面，JSON-LD 回到确认用的草稿并记下来源", async () => {
    const fetchFn = scripted([
      () => toolCall("fetch_page", { url: PAGE }, "call_fetch"),
      () => jsonMessage({ ...DRAFT, name: "红烧肉", sourceUrl: PAGE }),
    ])
    const pageFetch = vi.fn(async () => {
      return new Response(JSON_LD, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    })
    const searchFn = vi.fn()
    const statuses: string[] = []
    const outcome = await parsePastedRecipeInput(`朋友发的 ${PAGE} 你们做做`, {
      env: ENV,
      fetchFn: fetchFn,
      pageFetch: pageFetch,
      searchFn,
      onStatus: (message) => statuses.push(message),
    })
    expect(searchFn).not.toHaveBeenCalled()
    expect(statuses).toEqual(["正在读取 recipes.example…"])
    expect(outcome).toMatchObject({
      ok: true,
      draft: {
        name: "红烧肉",
        source: "ai",
        sourceUrl: PAGE,
      },
    })
    const followup = requestBody(fetchFn, 1)
    const toolMessage = followup.messages.find(
      (message) => message.role === "tool"
    )
    expect(toolMessage?.content).toContain("红烧肉")
    expect(toolMessage?.content).toContain("五花肉 500克")
    expect(toolMessage?.content).toContain("jsonld")
  })

  test("菜名先搜索再读一页", async () => {
    const hits: SearchHit[] = [
      {
        title: "红烧肉的做法",
        url: PAGE,
        snippet: "五花肉炒糖色",
      },
    ]
    const fetchFn = scripted([
      () => toolCall("web_search", { query: "红烧肉 做法" }, "call_search"),
      () => toolCall("fetch_page", { url: PAGE }, "call_fetch"),
      () => jsonMessage({ ...DRAFT, name: "红烧肉" }),
    ])
    const pageFetch = vi.fn(async () => {
      return new Response(
        "<html><body><article><p>五花肉 500 克，冷水下锅焯去血沫，捞出后炒糖色，加开水没过肉，小火焖四十分钟，盐少许。</p></article></body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    })
    const searchFn = vi.fn(async () => hits)
    const statuses: string[] = []
    const outcome = await parsePastedRecipeInput("帮我找个红烧肉的做法", {
      env: ENV,
      fetchFn: fetchFn,
      pageFetch: pageFetch,
      searchFn,
      onStatus: (message) => statuses.push(message),
    })
    expect(searchFn).toHaveBeenCalledWith("红烧肉 做法")
    expect(pageFetch).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(["正在搜索…", "正在读取 recipes.example…"])
    expect(outcome).toMatchObject({
      ok: true,
      draft: { name: "红烧肉", source: "ai", sourceUrl: PAGE },
    })
  })

  test("工具循环到 5 轮就停止，不再抓取", async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => {
      calls += 1
      if (calls > 5) {
        return chat({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_late",
              type: "function",
              function: {
                name: "fetch_page",
                arguments: JSON.stringify({ url: PAGE }),
              },
            },
          ],
        })
      }
      return toolCall("fetch_page", { url: PAGE }, `call_${calls}`)
    })
    const pageFetch = vi.fn(async () => {
      return new Response(JSON_LD, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    })
    const outcome = await parsePastedRecipeInput(PAGE, {
      env: ENV,
      fetchFn: fetchFn,
      pageFetch: pageFetch,
      searchFn: vi.fn(),
    })
    expect(pageFetch).toHaveBeenCalledTimes(5)
    expect(fetchFn).toHaveBeenCalledTimes(6)
    expect(requestBody(fetchFn, 5).tools).toBeUndefined()
    expect(requestBody(fetchFn, 5).response_format).toEqual({
      type: "json_object",
    })
    expect(outcome).toEqual({
      ok: false,
      message: "读了页面，但没抽出食谱。",
    })
  })

  test("没有搜索 key 时不向模型提供 web_search", () => {
    expect(
      recipeAgentTools({ env: { DEEPSEEK_API_KEY: "sk-test" } }).map(
        (tool) => tool.function.name
      )
    ).toEqual(["fetch_page"])
  })

  test("没有 DeepSeek key 时，完整文字走规则，链接不抓", async () => {
    const fetchFn = vi.fn()
    const pageFetch = vi.fn()
    const recipe = await parsePastedRecipeInput(FULL, {
      env: {},
      fetchFn: fetchFn as typeof fetch,
      pageFetch: pageFetch as typeof fetch,
    })
    expect(recipe).toMatchObject({
      ok: true,
      draft: { name: "番茄炒蛋", source: "rule" },
    })
    const link = await parsePastedRecipeInput(PAGE, {
      env: {},
      fetchFn: fetchFn as typeof fetch,
      pageFetch: pageFetch as typeof fetch,
    })
    expect(link).toEqual({
      ok: false,
      message: "没配 AI，读不了这个链接。",
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(pageFetch).not.toHaveBeenCalled()
  })

  test("菜名的合法草稿直接收下，要不要搜索由提示词决定", async () => {
    const fetchFn = scripted([() => jsonMessage(DRAFT)])
    const searchFn = vi.fn()
    const outcome = await parsePastedRecipeInput("红烧肉", {
      env: ENV,
      fetchFn: fetchFn,
      pageFetch: vi.fn() as typeof fetch,
      searchFn,
    })
    expect(searchFn).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({
      ok: true,
      draft: { name: "番茄炒蛋", source: "ai" },
    })
  })

  const STEW = `清炖土鸡
2 人份，90 分钟
土鸡 半只
蒜 3 瓣
姜 5 片
生抽 1 勺
枸杞 10 粒
盐 适量
1. 鸡块焯水
2. 加姜蒜小火炖 80 分钟
3. 放枸杞、盐调味`

  const STEW_RULE = {
    name: "清炖土鸡",
    servings: 2,
    approxMinutes: 90,
    source: "rule",
    items: [
      { rawName: "土鸡", quantity: 1, unit: "半只" },
      { rawName: "蒜", quantity: 3, unit: "瓣" },
      { rawName: "姜", quantity: 5, unit: "片" },
      { rawName: "生抽", quantity: 1, unit: "勺" },
      { rawName: "枸杞", quantity: 10, unit: "粒" },
      { rawName: "盐", quantity: 1, unit: "适量" },
    ],
    steps: ["鸡块焯水", "加姜蒜小火炖 80 分钟", "放枸杞、盐调味"],
  }

  test("清炖土鸡全文：模型直接返回就收下，不调工具", async () => {
    const fetchFn = scripted([
      () =>
        jsonMessage({
          name: "清炖土鸡",
          servings: 2,
          approxMinutes: 90,
          items: STEW_RULE.items,
          steps: STEW_RULE.steps,
          source: "user_text",
          sourceUrl: null,
        }),
    ])
    const pageFetch = vi.fn()
    const searchFn = vi.fn()
    const outcome = await parsePastedRecipeInput(STEW, {
      env: ENV,
      fetchFn,
      pageFetch: pageFetch as typeof fetch,
      searchFn,
    })
    expect(pageFetch).not.toHaveBeenCalled()
    expect(searchFn).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({
      ok: true,
      draft: {
        name: "清炖土鸡",
        source: "ai",
        evidence: "user_text",
        items: STEW_RULE.items,
        steps: STEW_RULE.steps,
      },
    })
  })

  test("清炖土鸡全文：没有 key 时得到完整规则草稿", async () => {
    const fetchFn = vi.fn()
    const outcome = await parsePastedRecipeInput(STEW, {
      env: {},
      fetchFn: fetchFn as typeof fetch,
      pageFetch: vi.fn() as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(outcome).toEqual({ ok: true, draft: STEW_RULE })
  })

  test("清炖土鸡全文：AI 返回异常时回退到规则草稿", async () => {
    const fetchFn = scripted([
      () =>
        chat({
          role: "assistant",
          content: "这不是食谱 JSON",
        }),
    ])
    const outcome = await parsePastedRecipeInput(STEW, {
      env: ENV,
      fetchFn,
      pageFetch: vi.fn() as typeof fetch,
      searchFn: vi.fn(),
    })
    expect(outcome).toEqual({ ok: true, draft: STEW_RULE })
  })

  test("没有 key 时纯菜名说明原因", async () => {
    const outcome = await parsePastedRecipeInput("清炖土鸡", { env: {} })
    expect(outcome).toEqual({
      ok: false,
      message: "没配 AI，没法按菜名搜索。",
    })
  })
})

describe("pickImportedSourceUrl", () => {
  test("只保留实际读到的页面", () => {
    expect(pickImportedSourceUrl("https://evil.example/a", [])).toBeUndefined()
    expect(pickImportedSourceUrl(undefined, [PAGE])).toBe(PAGE)
    expect(pickImportedSourceUrl("https://evil.example/a", [PAGE])).toBe(PAGE)
  })
})

describe("recipe agent prompt", () => {
  test("写明三种输入、中文输出和不编造", () => {
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("fetch_page")
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("web_search")
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("不要调用任何工具")
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("只有菜名时不要凭记忆")
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("user_text")
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("knowledge")
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("不要编造")
    expect(RECIPE_AGENT_SYSTEM_PROMPT).toContain("简体中文")
    expect(fetchRecipePage).toBeTypeOf("function")
  })
})
