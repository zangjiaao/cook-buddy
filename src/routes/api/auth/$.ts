import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleAuthRequest } = await import("@/lib/auth/auth.server")
        return handleAuthRequest(request)
      },
      POST: async ({ request }) => {
        const { handleAuthRequest } = await import("@/lib/auth/auth.server")
        return handleAuthRequest(request)
      },
    },
  },
})
