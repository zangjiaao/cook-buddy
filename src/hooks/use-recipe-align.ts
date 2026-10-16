import { useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { alignPayload } from "@/lib/ai/align-recipe"
import { alignRecipe } from "@/lib/ai/align-recipe.functions"
import {
  alignRecipeLines,
  editAlignQuantity,
  type AlignRecipeInput,
  type AlignResultLine,
} from "@/lib/recipe-align"

export function useRecipeAlign() {
  const alignOnServer = useServerFn(alignRecipe)
  const [lines, setLines] = useState<AlignResultLine[] | null>(null)
  const [aligning, setAligning] = useState(false)

  async function run(input: AlignRecipeInput) {
    setAligning(true)
    const local = alignRecipeLines(input)
    let next = local
    if (local.some((line) => line.needsAi)) {
      try {
        next = await alignOnServer({ data: alignPayload(input) })
      } catch {
        next = local
      }
    }
    setLines(next)
    setAligning(false)
    return next
  }

  function changeQuantity(key: string, quantity: number) {
    setLines((current) =>
      current ? editAlignQuantity(current, key, quantity) : current
    )
  }

  function clear() {
    setLines(null)
  }

  return { lines, aligning, run, changeQuantity, clear, setLines }
}
