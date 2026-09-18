import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/plan-draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 })
        }

        const { normalizePlanDraftInput } = await import("@/lib/plan-draft")
        const input = normalizePlanDraftInput(body)
        if (!input) {
          return Response.json({ error: "days required" }, { status: 400 })
        }

        const { generatePlanDraftWithAi } =
          await import("@/lib/ai/plan-draft.server")
        const { readDeepSeekRuntimeEnv } = await import("@/lib/ai/worker-env")
        const draft = await generatePlanDraftWithAi(input, {
          env: readDeepSeekRuntimeEnv(),
        })
        return Response.json(draft)
      },
    },
  },
})
