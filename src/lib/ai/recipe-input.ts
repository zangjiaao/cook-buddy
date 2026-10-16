import type { RecipeDraft } from "@/lib/ai/parse-recipe"

export type RecipeParseOutcome =
  { ok: true; draft: RecipeDraft } | { ok: false; message: string }

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？、）)】\]]+/gi

const QUANTITY_PATTERN =
  /\d+(?:\.\d+)?\s*(?:个|把|盒|袋|瓶|斤|克|千克|头|瓣|勺|块|毫升|g|kg|ml|杯|汤匙)/gi

export const LINK_UNREADABLE_MESSAGE =
  "这个链接读不到内容，可以把文字直接粘贴进来"

export const PASTE_INSTEAD_MESSAGE = "没能抽出食谱，可以把文字直接粘贴进来"

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

export function looksLikeFullRecipe(text: string): boolean {
  const body = text.replace(URL_PATTERN, " ")
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const hasSection = /食材|材料|用料|步骤|做法|ingredients|instructions/i.test(
    body
  )
  const quantities = body.match(QUANTITY_PATTERN)?.length ?? 0
  if (hasSection && (lines.length >= 3 || quantities >= 2)) return true
  return quantities >= 3 && lines.length >= 4
}

export function initialParseStatus(text: string): string {
  if (extractHttpUrls(text).length > 0) return "正在从链接读取…"
  if (looksLikeFullRecipe(text)) return "正在抽出…"
  return "正在搜索…"
}

export function recipeParseFailureMessage(text: string): string {
  return extractHttpUrls(text).length > 0
    ? LINK_UNREADABLE_MESSAGE
    : PASTE_INSTEAD_MESSAGE
}
