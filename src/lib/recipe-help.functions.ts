import { createServerFn } from "@tanstack/react-start"
import { readSession, requireDb, workerBindings } from "@/lib/auth/auth.server"
import { reviseHelpWithAi } from "@/lib/ai/recipe-help-revise.server"
import { readDeepSeekRuntimeEnv } from "@/lib/ai/worker-env"
import {
  closeRecipeShareLink,
  countPendingSuggestions,
  createRecipeShareLink,
  listPendingSuggestionCounts,
  listRecipeShareLinks,
  listRecipeSuggestions,
  readPublicRecipeHelp,
  reorganizeRecipeSuggestion,
  resolveRecipeSuggestion,
  submitRecipeHelp,
  submitSelfRecipeHelp,
} from "@/lib/recipe-help-store"
import type { HelpNote, RecipeHelpSnapshot } from "@/lib/recipe-help"

const RAW_LIMIT = 80_000

function reviseNote(snapshot: RecipeHelpSnapshot, note: HelpNote) {
  return reviseHelpWithAi(snapshot, note, { env: readDeepSeekRuntimeEnv() })
}

function tooLarge(data: unknown): boolean {
  try {
    return JSON.stringify(data).length > RAW_LIMIT
  } catch {
    return true
  }
}

export const createRecipeShare = createServerFn({ method: "POST" })
  .validator((data: { recipeId?: unknown; snapshot?: unknown }) => data)
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "请先登录。" }
    if (tooLarge(data)) {
      return { ok: false as const, reason: "内容太长了，缩短一点再提交。" }
    }
    return createRecipeShareLink(requireDb(workerBindings()), {
      userId: session.user.id,
      recipeId: data.recipeId,
      snapshot: data.snapshot,
    })
  })

export const getRecipeHelpDesk = createServerFn({ method: "POST" })
  .validator((data: { recipeId?: unknown }) => data)
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "请先登录。" }
    const recipeId = typeof data.recipeId === "string" ? data.recipeId : ""
    const db = requireDb(workerBindings())
    const [links, pendingCount] = await Promise.all([
      listRecipeShareLinks(db, session.user.id, recipeId),
      countPendingSuggestions(db, session.user.id, recipeId),
    ])
    return { ok: true as const, links, pendingCount }
  })

export const listRecipePendingCounts = createServerFn({
  method: "GET",
}).handler(async () => {
  const session = await readSession()
  if (!session?.user) return { ok: false as const, reason: "请先登录。" }
  const counts = await listPendingSuggestionCounts(
    requireDb(workerBindings()),
    session.user.id
  )
  return { ok: true as const, counts }
})

export const closeRecipeShare = createServerFn({ method: "POST" })
  .validator((data: { token?: unknown }) => data)
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "请先登录。" }
    const token = typeof data.token === "string" ? data.token : ""
    return closeRecipeShareLink(
      requireDb(workerBindings()),
      session.user.id,
      token
    )
  })

export const readRecipeHelp = createServerFn({ method: "POST" })
  .validator((data: { token?: unknown }) => data)
  .handler(async ({ data }) => {
    const token = typeof data.token === "string" ? data.token : ""
    return readPublicRecipeHelp(requireDb(workerBindings()), token)
  })

export const submitRecipeSuggestion = createServerFn({ method: "POST" })
  .validator((data: { token?: unknown; body?: unknown }) => data)
  .handler(async ({ data }) => {
    if (tooLarge(data)) {
      return { ok: false as const, reason: "内容太长了，缩短一点再提交。" }
    }
    const token = typeof data.token === "string" ? data.token : ""
    return submitRecipeHelp(requireDb(workerBindings()), {
      token,
      body: data.body,
      revise: reviseNote,
    })
  })

export const optimizeRecipe = createServerFn({ method: "POST" })
  .validator(
    (data: { recipeId?: unknown; snapshot?: unknown; comment?: unknown }) =>
      data
  )
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "请先登录。" }
    if (tooLarge(data)) {
      return { ok: false as const, reason: "内容太长了，缩短一点再提交。" }
    }
    return submitSelfRecipeHelp(requireDb(workerBindings()), {
      userId: session.user.id,
      recipeId: data.recipeId,
      snapshot: data.snapshot,
      body: { comment: data.comment },
      revise: reviseNote,
    })
  })

export const reorganizeOwnedSuggestion = createServerFn({ method: "POST" })
  .validator((data: { suggestionId?: unknown }) => data)
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "请先登录。" }
    const suggestionId =
      typeof data.suggestionId === "string" ? data.suggestionId : ""
    return reorganizeRecipeSuggestion(requireDb(workerBindings()), {
      userId: session.user.id,
      suggestionId,
      revise: reviseNote,
    })
  })

export const listOwnedRecipeSuggestions = createServerFn({ method: "POST" })
  .validator((data: { recipeId?: unknown }) => data)
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "请先登录。" }
    const recipeId = typeof data.recipeId === "string" ? data.recipeId : ""
    const suggestions = await listRecipeSuggestions(
      requireDb(workerBindings()),
      session.user.id,
      recipeId
    )
    return { ok: true as const, suggestions }
  })

export const settleRecipeSuggestion = createServerFn({ method: "POST" })
  .validator((data: { suggestionId?: unknown; decision?: unknown }) => data)
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "请先登录。" }
    const decision =
      data.decision === "accepted" || data.decision === "ignored"
        ? data.decision
        : null
    if (!decision) return { ok: false as const, reason: "处理方式不对。" }
    const suggestionId =
      typeof data.suggestionId === "string" ? data.suggestionId : ""
    return resolveRecipeSuggestion(requireDb(workerBindings()), {
      userId: session.user.id,
      suggestionId,
      decision,
    })
  })
