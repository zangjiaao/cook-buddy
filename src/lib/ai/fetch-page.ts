import { publicHttpUrlError, sanitizeStoredSourceUrl } from "@/lib/source-url"

export const FETCH_PAGE_TIMEOUT_MS = 8_000
export const FETCH_PAGE_MAX_BYTES = 1_000_000
export const FETCH_PAGE_TEXT_CHARS = 8_000
const MAX_REDIRECTS = 3
const MIN_TEXT_CHARS = 40

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export type JsonLdRecipe = {
  name: string
  recipeYield: string | null
  servings: number | null
  prepTime: string | null
  cookTime: string | null
  totalTime: string | null
  minutes: number | null
  recipeIngredient: string[]
  recipeInstructions: string[]
}

export type FetchPageResult =
  | { ok: true; url: string; kind: "jsonld"; recipe: JsonLdRecipe }
  | { ok: true; url: string; kind: "text"; text: string }
  | { ok: false; url?: string; error: string }

export type FetchPageOptions = {
  fetchFn?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ""
    })
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
}

function regionText(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(
    html
  )
  if (!match?.[1]) return null
  const text = decodeHtml(stripNoise(match[1]).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  return text.length > MIN_TEXT_CHARS ? text : null
}

export function htmlToText(html: string): string {
  const region =
    regionText(html, "article") ??
    regionText(html, "main") ??
    regionText(html, "body") ??
    decodeHtml(stripNoise(html).replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
  return region.replace(/\s+/g, " ").trim().slice(0, FETCH_PAGE_TEXT_CHARS)
}

function isRecipeType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value]
  return types.some((type) => {
    if (typeof type !== "string") return false
    return type.split(/[/:]/).pop()?.toLowerCase() === "recipe"
  })
}

function collectNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out)
    return
  }
  const record = asRecord(value)
  if (!record) return
  if (isRecipeType(record["@type"])) out.push(record)
  if (record["@graph"]) collectNodes(record["@graph"], out)
}

function textOf(value: unknown): string {
  if (typeof value === "string")
    return decodeHtml(value).replace(/\s+/g, " ").trim()
  if (typeof value === "number") return String(value)
  const record = asRecord(value)
  if (!record) return ""
  return textOf(record.text ?? record.name ?? record["@value"])
}

function stringList(value: unknown, limit: number): string[] {
  const source = Array.isArray(value) ? value : value == null ? [] : [value]
  const items: string[] = []
  const visit = (node: unknown) => {
    if (items.length >= limit) return
    if (typeof node === "string" || typeof node === "number") {
      const text = textOf(node)
      if (text) items.push(text)
      return
    }
    const record = asRecord(node)
    if (!record) return
    if (Array.isArray(record.itemListElement)) {
      for (const child of record.itemListElement) visit(child)
      return
    }
    const text = textOf(record)
    if (text) items.push(text)
  }
  for (const item of source) visit(item)
  return items
}

function durationMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/i.exec(
    value.trim()
  )
  if (!match) return null
  const days = Number(match[1] || 0)
  const hours = Number(match[2] || 0)
  const minutes = Number(match[3] || 0)
  const seconds = Number(match[4] || 0)
  const total = days * 24 * 60 + hours * 60 + minutes + Math.round(seconds / 60)
  return total > 0 ? total : null
}

function servingsFromYield(value: string | null): number | null {
  if (!value) return null
  const match = /(\d+)/.exec(value)
  if (!match) return null
  const servings = Number(match[1])
  return Number.isFinite(servings) && servings > 0 ? servings : null
}

function toJsonLdRecipe(node: Record<string, unknown>): JsonLdRecipe | null {
  const name = textOf(node.name)
  const ingredients = stringList(node.recipeIngredient, 80)
  const instructions = stringList(node.recipeInstructions ?? node.step, 40)
  if (!name || (ingredients.length === 0 && instructions.length === 0)) {
    return null
  }
  const recipeYield = textOf(node.recipeYield) || null
  const prepTime = textOf(node.prepTime) || null
  const cookTime = textOf(node.cookTime) || null
  const totalTime = textOf(node.totalTime) || null
  const minutes =
    durationMinutes(totalTime) ??
    sumMinutes(durationMinutes(prepTime), durationMinutes(cookTime))
  return {
    name,
    recipeYield,
    servings: servingsFromYield(recipeYield),
    prepTime,
    cookTime,
    totalTime,
    minutes,
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
  }
}

function sumMinutes(left: number | null, right: number | null): number | null {
  if (left == null && right == null) return null
  return (left ?? 0) + (right ?? 0) || null
}

export function recipeFromHtml(html: string): FetchPageResult {
  const scripts =
    html.match(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) ?? []
  for (const script of scripts) {
    const body = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      continue
    }
    const nodes: Record<string, unknown>[] = []
    collectNodes(parsed, nodes)
    for (const node of nodes) {
      const recipe = toJsonLdRecipe(node)
      if (recipe) return { ok: true, url: "", kind: "jsonld", recipe }
    }
  }
  const text = htmlToText(html)
  if (text.length < MIN_TEXT_CHARS) {
    return { ok: false, error: "页面没有可用正文" }
  }
  return { ok: true, url: "", kind: "text", text }
}

function decoderFor(contentType: string): TextDecoder {
  const match = /charset=([^;]+)/i.exec(contentType)
  const charset = match?.[1]?.trim().toLowerCase().replace(/["']/g, "")
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset)
    } catch {
      return new TextDecoder("utf-8")
    }
  }
  return new TextDecoder("utf-8")
}

async function readLimited(
  response: Response,
  maxBytes: number,
  contentType: string
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = await response.arrayBuffer()
    const bytes =
      buffer.byteLength > maxBytes ? buffer.slice(0, maxBytes) : buffer
    return decoderFor(contentType).decode(bytes)
  }
  const decoder = decoderFor(contentType)
  let received = 0
  let text = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      const keep = value.byteLength - (received - maxBytes)
      if (keep > 0)
        text += decoder.decode(value.subarray(0, keep), { stream: true })
      await reader.cancel()
      break
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

function redirectUrl(current: string, location: string): string | null {
  try {
    return new URL(location, current).href
  } catch {
    return null
  }
}

export async function fetchRecipePage(
  input: string,
  options: FetchPageOptions = {}
): Promise<FetchPageResult> {
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? FETCH_PAGE_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? FETCH_PAGE_MAX_BYTES
  let current = input.trim()
  const blocked = publicHttpUrlError(current)
  if (blocked) return { ok: false, url: current, error: blocked }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const hopError = publicHttpUrlError(current)
    if (hopError) return { ok: false, url: current, error: hopError }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchFn(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        const next = location ? redirectUrl(current, location) : null
        await response.body?.cancel()
        if (!next) return { ok: false, url: current, error: "重定向无效" }
        current = next
        continue
      }
      if (response.url && publicHttpUrlError(response.url)) {
        await response.body?.cancel()
        return { ok: false, url: response.url, error: "不读取内网或本机地址" }
      }
      if (!response.ok) {
        return { ok: false, url: current, error: `页面返回 ${response.status}` }
      }
      const contentType = response.headers.get("content-type") ?? ""
      if (contentType && !/text\/|xml|json|html/i.test(contentType)) {
        return { ok: false, url: current, error: "不是网页文本" }
      }
      const html = await readLimited(response, maxBytes, contentType)
      const parsed = recipeFromHtml(html)
      const finalUrl = sanitizeStoredSourceUrl(current) ?? current
      if (!parsed.ok) return { ...parsed, url: finalUrl }
      return { ...parsed, url: finalUrl }
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      return {
        ok: false,
        url: current,
        error: aborted ? "抓取超时" : "抓取失败",
      }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, url: current, error: "重定向过多" }
}
