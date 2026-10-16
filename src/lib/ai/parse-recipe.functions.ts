import { createServerFn } from "@tanstack/react-start"
import { parsePastedRecipeInput } from "@/lib/ai/recipe-agent"
import { readRecipeRuntimeEnv } from "@/lib/ai/worker-env"

export const parsePastedRecipe = createServerFn({ method: "POST" })
  .validator((data: { text: string }) => {
    if (typeof data.text !== "string") {
      throw new Error("text required")
    }
    return { text: data.text }
  })
  .handler(async ({ data }) => {
    const outcome = await parsePastedRecipeInput(data.text, {
      env: readRecipeRuntimeEnv(),
    })
    if (!outcome.ok) throw new Error(outcome.message)
    return outcome.draft
  })
