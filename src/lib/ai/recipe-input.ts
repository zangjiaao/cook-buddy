import { recipeLineRole } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"

export type RecipeParseOutcome =
  { ok: true; draft: RecipeDraft } | { ok: false; message: string }

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？、）)】\]]+/gi

export const AI_MISSING_LINK_MESSAGE = "没配 AI，读不了这个链接。"
export const AI_MISSING_NAME_MESSAGE = "没配 AI，没法按菜名搜索。"
export const AI_NETWORK_MESSAGE = "网络或超时，没能连上 AI。"
export const SEARCH_MISS_MESSAGE = "没搜到可用的做法。"
export const PAGE_UNREADABLE_MESSAGE = "这个网页读不到。"
export const PAGE_NO_DRAFT_MESSAGE = "读了页面，但没抽出食谱。"

export function extractHttpUrls(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? []
  const urls: string[] = []
  const seen = new Set<string>()
  for (const raw of found) {
    const cleaned = raw.replace(/[.,;:!?，。！？、]+$/g, "")
    try {
      const url = new URL(cleaned)
      if (url.protocol !== "http:" && url.protocol !== "https:") continue
      if (seen.has(url.href)) continue
      seen.add(url.href)
      urls.push(url.href)
    } catch {
      // 半截链接留给模型或规则层处理。
    }
  }
  return urls
}

/** 文字里已经有用料或步骤。纯菜名、求做法的一句话、只有链接时为 false。 */
export function looksLikeFullRecipe(text: string): boolean {
  const body = text.replace(URL_PATTERN, " ")
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const roles = lines.map((line) => recipeLineRole(line))
  const items = roles.filter((role) => role === "item").length
  const steps = roles.filter((role) => role === "step").length
  const hasSection =
    roles.some((role) => role === "section") ||
    /食材|材料|用料|步骤|做法|ingredients|instructions/i.test(body)
  if (
    extractHttpUrls(text).length > 0 &&
    items === 0 &&
    steps === 0 &&
    !hasSection
  ) {
    return false
  }
  if (hasSection && (items >= 1 || steps >= 1 || lines.length >= 3)) return true
  return items >= 2 || (items >= 1 && steps >= 1)
}

export function missingAiMessage(text: string): string {
  return extractHttpUrls(text).length > 0
    ? AI_MISSING_LINK_MESSAGE
    : AI_MISSING_NAME_MESSAGE
}

export function aiCallFailureMessage(error: unknown, text: string): string {
  const name = error instanceof Error ? error.name : ""
  const message = error instanceof Error ? error.message : ""
  if (
    name === "AbortError" ||
    /timeout|aborted|HTTP|network|fetch/i.test(message)
  ) {
    return AI_NETWORK_MESSAGE
  }
  return recipeParseFailureMessage(text)
}

export function initialParseStatus(text: string): string {
  if (extractHttpUrls(text).length > 0) return "正在从链接读取…"
  if (looksLikeFullRecipe(text)) return "正在抽出…"
  return "正在搜索…"
}

export function recipeParseFailureMessage(text: string): string {
  return extractHttpUrls(text).length > 0
    ? PAGE_UNREADABLE_MESSAGE
    : SEARCH_MISS_MESSAGE
}
