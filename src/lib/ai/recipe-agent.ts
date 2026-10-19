import { isAiEnabled, requestDeepSeekChat } from "@/lib/ai/deepseek"
import type {
  DeepSeekChatMessage,
  DeepSeekRequestOptions,
  DeepSeekToolCall,
  DeepSeekToolSpec,
  EnvLike,
} from "@/lib/ai/deepseek"
import { fetchRecipePage } from "@/lib/ai/fetch-page"
import type { FetchPageResult } from "@/lib/ai/fetch-page"
import { fallbackParse, tryParseRecipeDraftJson } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"
import {
  RECIPE_AGENT_FINAL_NUDGE,
  RECIPE_AGENT_SYSTEM_PROMPT,
} from "@/lib/ai/recipe-agent-prompt"
import {
  aiCallFailureMessage,
  extractHttpUrls,
  looksLikeFullRecipe,
  missingAiMessage,
  PAGE_NO_DRAFT_MESSAGE,
  PAGE_UNREADABLE_MESSAGE,
  recipeParseFailureMessage,
  SEARCH_MISS_MESSAGE,
} from "@/lib/ai/recipe-input"
import type { RecipeParseOutcome } from "@/lib/ai/recipe-input"
import { resolveSearchProvider, webSearch } from "@/lib/ai/web-search"
import type { SearchHit } from "@/lib/ai/web-search"
import { sanitizeStoredSourceUrl, sourceUrlHost } from "@/lib/source-url"

export const MAX_TOOL_ROUNDS = 5
const MAX_FETCHES_PER_ROUND = 2
const MAX_SEARCHES_PER_ROUND = 1

const FETCH_PAGE_TOOL: DeepSeekToolSpec = {
  type: "function",
  function: {
    name: "fetch_page",
    description:
      "读取一个 http(s) 网页。有 schema.org Recipe JSON-LD 时返回结构化食谱，否则返回正文纯文本。用户输入里的链接要先读。",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "要读取的 http 或 https 地址",
        },
      },
      required: ["url"],
    },
  },
}

const WEB_SEARCH_TOOL: DeepSeekToolSpec = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "搜索家常菜谱网页，返回标题、URL 和摘要。用于只有菜名或一句话请求，以及链接读不到、内容不是食谱时。不要用它搜索已经贴出的完整做法。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "菜名或做法关键词" },
      },
      required: ["query"],
    },
  },
}

export type { RecipeParseOutcome } from "@/lib/ai/recipe-input"

export type RecipeAgentOptions = DeepSeekRequestOptions & {
  pageFetch?: typeof fetch
  searchFn?: (query: string) => Promise<SearchHit[]>
  onStatus?: (message: string) => void
  maxToolRounds?: number
}

function toolContent(value: unknown): string {
  return JSON.stringify(value)
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

function samePage(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    a.hash = ""
    b.hash = ""
    return a.href.replace(/\/$/, "") === b.href.replace(/\/$/, "")
  } catch {
    return false
  }
}

export function pickImportedSourceUrl(
  cited: string | undefined,
  fetched: readonly string[]
): string | undefined {
  const pages = fetched
    .map((url) => sanitizeStoredSourceUrl(url))
    .filter((url): url is string => Boolean(url))
  const wanted = sanitizeStoredSourceUrl(cited)
  if (wanted && pages.some((url) => samePage(url, wanted))) return wanted
  return pages.at(-1)
}

function withSource(
  draft: RecipeDraft,
  fetched: readonly string[]
): RecipeDraft {
  const sourceUrl = pickImportedSourceUrl(draft.sourceUrl, fetched)
  const next: RecipeDraft = { ...draft }
  delete next.sourceUrl
  if (sourceUrl) next.sourceUrl = sourceUrl
  return next
}

function readingStatus(url: string): string {
  const host = sourceUrlHost(url)
  return host ? `正在读取 ${host}…` : "正在读取页面…"
}

function pageWasUseful(
  result: FetchPageResult
): result is Extract<FetchPageResult, { ok: true }> {
  return result.ok
}

export function recipeAgentTools(options: {
  env?: EnvLike
  searchFn?: RecipeAgentOptions["searchFn"]
}): DeepSeekToolSpec[] {
  const tools = [FETCH_PAGE_TOOL]
  if (options.searchFn || resolveSearchProvider(options.env)) {
    tools.unshift(WEB_SEARCH_TOOL)
  }
  return tools
}

async function runRecipeAgent(
  text: string,
  options: RecipeAgentOptions
): Promise<RecipeParseOutcome> {
  const tools = recipeAgentTools(options)
  const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS
  const messages: DeepSeekChatMessage[] = [
    { role: "system", content: RECIPE_AGENT_SYSTEM_PROMPT },
    { role: "user", content: text },
  ]
  const fetched: string[] = []
  const attempt = { searchCalls: 0, searchHits: 0 }
  let rounds = 0
  let nudged = false

  while (rounds <= maxRounds) {
    const allowTools = rounds < maxRounds && tools.length > 0
    if (!allowTools && !nudged && rounds > 0) {
      messages.push({ role: "user", content: RECIPE_AGENT_FINAL_NUDGE })
      nudged = true
    }
    const turn = await requestDeepSeekChat(messages, {
      ...options,
      tools: allowTools ? tools : undefined,
      jsonMode: !allowTools,
    })
    if (!allowTools || turn.toolCalls.length === 0) {
      const draft = turn.content
        ? tryParseRecipeDraftJson(turn.content, "ai")
        : null
      if (draft) return { ok: true, draft: withSource(draft, fetched) }
      return { ok: false, message: unfinishedMessage(text, fetched, attempt) }
    }

    rounds += 1
    messages.push(turn.assistant)
    const counts = { fetch_page: 0, web_search: 0 }
    for (const call of turn.toolCalls) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: await runToolCall(call, counts, fetched, attempt, options),
      })
    }
  }

  return { ok: false, message: unfinishedMessage(text, fetched, attempt) }
}

function unfinishedMessage(
  text: string,
  fetched: readonly string[],
  attempt: { searchCalls: number; searchHits: number }
): string {
  if (extractHttpUrls(text).length > 0) {
    return fetched.length > 0 ? PAGE_NO_DRAFT_MESSAGE : PAGE_UNREADABLE_MESSAGE
  }
  if (attempt.searchCalls > 0 && attempt.searchHits === 0) {
    return SEARCH_MISS_MESSAGE
  }
  return recipeParseFailureMessage(text)
}

async function runToolCall(
  call: DeepSeekToolCall,
  counts: { fetch_page: number; web_search: number },
  fetched: string[],
  attempt: { searchCalls: number; searchHits: number },
  options: RecipeAgentOptions
): Promise<string> {
  const args = parseArgs(call.arguments)
  if (call.name === "web_search") {
    if (counts.web_search >= MAX_SEARCHES_PER_ROUND) {
      return toolContent({ ok: false, error: "这一轮已经搜索过了" })
    }
    counts.web_search += 1
    return searchTool(args, attempt, options)
  }
  if (call.name === "fetch_page") {
    if (counts.fetch_page >= MAX_FETCHES_PER_ROUND) {
      return toolContent({ ok: false, error: "这一轮已经读过足够的页面" })
    }
    counts.fetch_page += 1
    return fetchTool(args, fetched, options)
  }
  return toolContent({ ok: false, error: "没有这个工具" })
}

async function searchTool(
  args: Record<string, unknown> | null,
  attempt: { searchCalls: number; searchHits: number },
  options: RecipeAgentOptions
): Promise<string> {
  const query = typeof args?.query === "string" ? args.query : ""
  attempt.searchCalls += 1
  options.onStatus?.("正在搜索…")
  try {
    if (options.searchFn) {
      const results = await options.searchFn(query)
      attempt.searchHits += results.length
      return toolContent({ ok: true, results })
    }
    const result = await webSearch(query, { env: options.env })
    if (result.ok) attempt.searchHits += result.results.length
    return toolContent(result)
  } catch {
    return toolContent({ ok: false, error: "搜索失败" })
  }
}

async function fetchTool(
  args: Record<string, unknown> | null,
  fetched: string[],
  options: RecipeAgentOptions
): Promise<string> {
  const url = typeof args?.url === "string" ? args.url.trim() : ""
  if (!url) return toolContent({ ok: false, error: "缺少网址" })
  options.onStatus?.(readingStatus(url))
  try {
    const result = await fetchRecipePage(url, { fetchFn: options.pageFetch })
    if (pageWasUseful(result)) fetched.push(result.url)
    return toolContent(result)
  } catch {
    return toolContent({ ok: false, url, error: "抓取失败" })
  }
}

export async function parsePastedRecipeInput(
  text: string,
  options: RecipeAgentOptions = {}
): Promise<RecipeParseOutcome> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, message: "先贴一点内容。" }
  if (!isAiEnabled(options.env)) {
    if (looksLikeFullRecipe(trimmed)) {
      return { ok: true, draft: fallbackParse(trimmed) }
    }
    return { ok: false, message: missingAiMessage(trimmed) }
  }
  try {
    const outcome = await runRecipeAgent(trimmed, options)
    if (outcome.ok) return outcome
    if (looksLikeFullRecipe(trimmed)) {
      return { ok: true, draft: fallbackParse(trimmed) }
    }
    return outcome
  } catch (error) {
    if (looksLikeFullRecipe(trimmed)) {
      return { ok: true, draft: fallbackParse(trimmed) }
    }
    return { ok: false, message: aiCallFailureMessage(error, trimmed) }
  }
}
