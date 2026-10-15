import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/classify-ingredients")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 })
        }

        const record =
          body && typeof body === "object"
            ? (body as Record<string, unknown>)
            : {}
        const names = Array.isArray(record.names)
          ? record.names
              .map((name) => String(name ?? "").trim())
              .filter(Boolean)
              .slice(0, 80)
          : []

        const { classifyIngredientsWithAi } =
          await import("@/lib/ai/classify-ingredients.server")
        const { readDeepSeekRuntimeEnv } = await import("@/lib/ai/worker-env")
        const results = await classifyIngredientsWithAi(names, {
          env: readDeepSeekRuntimeEnv(),
        })
        return Response.json({ results })
      },
    },
  },
})
