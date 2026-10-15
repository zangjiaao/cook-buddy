import { createServerFn } from "@tanstack/react-start"
import { classifyIngredientsWithAi } from "@/lib/ai/classify-ingredients.server"
import { readDeepSeekRuntimeEnv } from "@/lib/ai/worker-env"

export const classifyIngredientCategories = createServerFn({ method: "POST" })
  .validator((data: { names?: unknown }) => {
    const names = Array.isArray(data.names)
      ? data.names.map((name) => String(name ?? "").trim()).filter(Boolean)
      : []
    return { names: names.slice(0, 80) }
  })
  .handler(async ({ data }) => {
    return classifyIngredientsWithAi(data.names, {
      env: readDeepSeekRuntimeEnv(),
    })
  })
