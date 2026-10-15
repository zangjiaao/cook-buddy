import { createServerFn } from "@tanstack/react-start"
import { parseInventoryUtteranceWithAi } from "@/lib/ai/parse-inventory.server"
import { readDeepSeekRuntimeEnv } from "@/lib/ai/worker-env"

export const parseInventoryUtterance = createServerFn({ method: "POST" })
  .validator((data: { text?: unknown }) => {
    return { text: String(data.text ?? "").slice(0, 500) }
  })
  .handler(async ({ data }) => {
    return parseInventoryUtteranceWithAi(data.text, {
      env: readDeepSeekRuntimeEnv(),
    })
  })
