import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/parse-recipe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 })
        }

        const text =
          body &&
          typeof body === "object" &&
          "text" in body &&
          typeof body.text === "string"
            ? body.text
            : ""

        const { parseRecipeWithAi } =
          await import("@/lib/ai/parse-recipe.server")
        const { readDeepSeekRuntimeEnv } = await import("@/lib/ai/worker-env")
        const draft = await parseRecipeWithAi(text, {
          env: readDeepSeekRuntimeEnv(),
        })
        return Response.json(draft)
      },
    },
  },
})
