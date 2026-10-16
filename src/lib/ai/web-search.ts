import type { EnvLike } from "@/lib/ai/deepseek"
import { publicHttpUrlError } from "@/lib/source-url"

export const SEARCH_TIMEOUT_MS = 8_000
export const SEARCH_RESULT_LIMIT = 5
const SNIPPET_CHARS = 300

export type SearchHit = {
  title: string
  url: string
  snippet: string
}

export type WebSearchResult =
  { ok: true; results: SearchHit[] } | { ok: false; error: string }

export type SearchProviderName = "tavily" | "brave"

export type WebSearchOptions = {
  env?: EnvLike
  fetchFn?: typeof fetch
  timeoutMs?: number
}

export function resolveSearchProvider(
  env?: EnvLike
): { provider: SearchProviderName; apiKey: string } | null {
  const tavily = env?.TAVILY_API_KEY?.trim()
  if (tavily) return { provider: "tavily", apiKey: tavily }
  const brave = env?.BRAVE_SEARCH_API_KEY?.trim()
  if (brave) return { provider: "brave", apiKey: brave }
  return null
}

function clip(value: string): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function hitsFrom(rows: unknown, snippetKey: string): SearchHit[] {
  if (!Array.isArray(rows)) return []
  const hits: SearchHit[] = []
  for (const row of rows) {
    if (hits.length >= SEARCH_RESULT_LIMIT) break
    const record = asRecord(row)
    if (!record) continue
    const url = typeof record.url === "string" ? record.url.trim() : ""
    if (!url || publicHttpUrlError(url)) continue
    const title = typeof record.title === "string" ? clip(record.title) : ""
    const snippetRaw = record[snippetKey]
    const snippet = typeof snippetRaw === "string" ? clip(snippetRaw) : ""
    if (!title && !snippet) continue
    hits.push({ title: title || url, url, snippet })
  }
  return hits
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>
}

export async function webSearch(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebSearchResult> {
  const trimmed = query.trim().slice(0, 200)
  if (!trimmed) return { ok: false, error: "缺少搜索词" }
  const provider = resolveSearchProvider(options.env)
  if (!provider) return { ok: false, error: "没有配置搜索" }

  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response =
      provider.provider === "tavily"
        ? await fetchFn("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: provider.apiKey,
              query: trimmed,
              max_results: SEARCH_RESULT_LIMIT,
              search_depth: "basic",
              include_answer: false,
            }),
            signal: controller.signal,
          })
        : await fetchFn(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(trimmed)}&count=${SEARCH_RESULT_LIMIT}`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                "X-Subscription-Token": provider.apiKey,
              },
              signal: controller.signal,
            }
          )
    if (!response.ok) return { ok: false, error: "搜索失败" }
    const payload = await readJson(response)
    const record = asRecord(payload)
    const results =
      provider.provider === "tavily"
        ? hitsFrom(record?.results, "content")
        : hitsFrom(asRecord(record?.web)?.results, "description")
    return { ok: true, results }
  } catch (error) {
    const aborted =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    return { ok: false, error: aborted ? "搜索超时" : "搜索失败" }
  } finally {
    clearTimeout(timer)
  }
}
