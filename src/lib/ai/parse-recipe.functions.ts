import { createServerFn } from "@tanstack/react-start"
import { parseRecipeWithAi } from "@/lib/ai/parse-recipe.server"

export const parsePastedRecipe = createServerFn({ method: "POST" })
  .validator((data: { text: string }) => {
    if (typeof data.text !== "string") {
      throw new Error("text required")
    }
    return { text: data.text }
  })
  .handler(async ({ data }) => {
    return parseRecipeWithAi(data.text)
  })
