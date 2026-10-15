import { createAuth } from "@/lib/auth/create-auth"
import type { AppD1Database } from "@/lib/db/d1"
import { env } from "cloudflare:workers"

export type WorkerBindings = {
  DB?: AppD1Database
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
  DEEPSEEK_MODEL?: string
}

/** Local `pnpm dev` only. Production must set the Worker secret. */
export const DEV_AUTH_SECRET = "dev-only-cookbuddy-secret-not-for-production"

export function workerBindings(): WorkerBindings {
  return env
}

export function resolveAuthSecret(bindings: WorkerBindings): string {
  const fromBinding = bindings.BETTER_AUTH_SECRET?.trim()
  if (fromBinding) return fromBinding
  const fromProcess =
    typeof process !== "undefined" ? process.env.BETTER_AUTH_SECRET?.trim() : ""
  if (fromProcess) return fromProcess
  if (import.meta.env.DEV) return DEV_AUTH_SECRET
  throw new Error("缺少 BETTER_AUTH_SECRET")
}

export function resolveAuthBaseURL(
  bindings: WorkerBindings,
  request?: Request
): string | undefined {
  const configured =
    bindings.BETTER_AUTH_URL?.trim() ||
    (typeof process !== "undefined" ? process.env.BETTER_AUTH_URL?.trim() : "")
  if (configured) return configured.replace(/\/+$/, "")
  if (!request) return undefined
  return new URL(request.url).origin
}

export function requireDb(bindings: WorkerBindings): AppD1Database {
  if (!bindings.DB) throw new Error("没有 D1 绑定 DB")
  return bindings.DB
}

export function authForRequest(request?: Request) {
  const bindings = workerBindings()
  return createAuth({
    db: requireDb(bindings),
    secret: resolveAuthSecret(bindings),
    baseURL: resolveAuthBaseURL(bindings, request),
    cookies: true,
  })
}

export async function readSession(request?: Request) {
  const current =
    request ?? (await import("@tanstack/react-start/server")).getRequest()
  const auth = authForRequest(current)
  return auth.api.getSession({ headers: current.headers })
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const auth = authForRequest(request)
  return auth.handler(request)
}
