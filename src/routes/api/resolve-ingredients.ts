import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/resolve-ingredients")({
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

        const { resolveIngredientsWithAi } =
          await import("@/lib/ai/resolve-ingredients.server")
        try {
          const results = await resolveIngredientsWithAi({
            items: Array.isArray(record.items) ? (record.items as never) : [],
            ingredients: Array.isArray(record.ingredients)
              ? (record.ingredients as never)
              : [],
          })
          return Response.json({ results })
        } catch (error) {
          console.error("resolve-ingredients failed", error)
          return Response.json({ error: "resolve failed" }, { status: 400 })
        }
      },
    },
  },
})
