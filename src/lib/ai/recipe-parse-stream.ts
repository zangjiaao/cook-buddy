import type { RecipeDraft } from "@/lib/ai/parse-recipe"
import { recipeParseFailureMessage } from "@/lib/ai/recipe-input"
import type { RecipeParseOutcome } from "@/lib/ai/recipe-input"

export async function readRecipeParseEvents(
  body: ReadableStream<Uint8Array>,
  onStatus: (message: string) => void
): Promise<RecipeParseOutcome | null> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let outcome: RecipeParseOutcome | null = null
  const take = (line: string) => {
    if (!line.trim()) return
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (!event || typeof event !== "object") return
    const record = event as {
      type?: unknown
      message?: unknown
      outcome?: unknown
    }
    if (record.type === "status" && typeof record.message === "string") {
      onStatus(record.message)
      return
    }
    if (
      record.type === "result" &&
      record.outcome &&
      typeof record.outcome === "object"
    ) {
      const parsed = record.outcome as {
        ok?: unknown
        message?: unknown
        draft?: unknown
      }
      if (
        parsed.ok === true &&
        parsed.draft &&
        typeof parsed.draft === "object"
      ) {
        outcome = { ok: true, draft: parsed.draft as RecipeDraft }
        return
      }
      if (parsed.ok === false && typeof parsed.message === "string") {
        outcome = { ok: false, message: parsed.message }
      }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) take(line)
  }
  buffer += decoder.decode()
  if (buffer.trim()) take(buffer)
  return outcome
}

export async function requestRecipeParse(
  text: string,
  onStatus: (message: string) => void
): Promise<RecipeParseOutcome> {
  const response = await fetch("/api/parse-recipe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) {
    let message = recipeParseFailureMessage(text)
    try {
      const payload = (await response.json()) as { error?: unknown }
      if (typeof payload.error === "string" && payload.error)
        message = payload.error
    } catch {
      // 保留按输入选好的失败文案。
    }
    return { ok: false, message }
  }
  if (!response.body) throw new Error("parse failed")
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("ndjson")) {
    const payload = (await response.json()) as RecipeDraft | { error?: unknown }
    if (typeof payload === "object" && "error" in payload) {
      const message =
        typeof payload.error === "string" && payload.error
          ? payload.error
          : recipeParseFailureMessage(text)
      return { ok: false, message }
    }
    if (typeof payload === "object" && "name" in payload) {
      return { ok: true, draft: payload }
    }
    throw new Error("parse failed")
  }
  const outcome = await readRecipeParseEvents(response.body, onStatus)
  if (!outcome) throw new Error("parse failed")
  return outcome
}
