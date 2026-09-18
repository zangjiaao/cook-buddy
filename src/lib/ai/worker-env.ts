import { env } from "cloudflare:workers"
import { resolveDeepSeekEnv } from "@/lib/ai/deepseek"
import type { EnvLike } from "@/lib/ai/deepseek"

/**
 * Read DeepSeek secrets inside a request handler.
 * `cloudflare:workers` `env` is the canonical Workers binding; `process.env`
 * still covers local `pnpm dev` / `.env.local`.
 */
export function readDeepSeekRuntimeEnv(): EnvLike {
  return resolveDeepSeekEnv(env)
}
