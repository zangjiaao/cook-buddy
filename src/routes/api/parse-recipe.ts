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

        const { parsePastedRecipeInput } = await import("@/lib/ai/recipe-agent")
        const { recipeParseFailureMessage } =
          await import("@/lib/ai/recipe-input")
        const { readRecipeRuntimeEnv } = await import("@/lib/ai/worker-env")
        const env = readRecipeRuntimeEnv()
        const wantsStream = (request.headers.get("accept") ?? "").includes(
          "application/x-ndjson"
        )

        if (!wantsStream) {
          const outcome = await parsePastedRecipeInput(text, { env })
          if (!outcome.ok) {
            return Response.json({ error: outcome.message }, { status: 422 })
          }
          return Response.json(outcome.draft)
        }

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: unknown) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
            }
            try {
              const outcome = await parsePastedRecipeInput(text, {
                env,
                onStatus: (message) => send({ type: "status", message }),
              })
              send({ type: "result", outcome })
            } catch {
              send({
                type: "result",
                outcome: {
                  ok: false,
                  message: recipeParseFailureMessage(text),
                },
              })
            } finally {
              controller.close()
            }
          },
        })
        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
          },
        })
      },
    },
  },
})
