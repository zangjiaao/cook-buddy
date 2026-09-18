import { createServerFn } from "@tanstack/react-start"
import { generatePlanDraftWithAi } from "@/lib/ai/plan-draft.server"
import { readDeepSeekRuntimeEnv } from "@/lib/ai/worker-env"
import { normalizePlanDraftInput } from "@/lib/plan-draft"

export const generateMealPlanDraft = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const input = normalizePlanDraftInput(data)
    if (!input) throw new Error("days required")
    return input
  })
  .handler(async ({ data }) => {
    return generatePlanDraftWithAi(data, { env: readDeepSeekRuntimeEnv() })
  })
