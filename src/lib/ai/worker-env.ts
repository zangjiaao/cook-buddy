import { env } from "cloudflare:workers"
import { pickRecipeAgentEnv, resolveDeepSeekEnv } from "@/lib/ai/deepseek"
import type { EnvLike } from "@/lib/ai/deepseek"

/**
 * Read DeepSeek secrets inside a request handler.
 * `cloudflare:workers` `env` is the canonical Workers binding; `process.env`
 * still covers local `pnpm dev` / `.env.local`.
 */
export function readDeepSeekRuntimeEnv(): EnvLike {
  return resolveDeepSeekEnv(env)
}

/** DeepSeek 加上搜索 key。Cloudflare env 优先于 process.env。 */
export function readRecipeRuntimeEnv(): EnvLike {
  return pickRecipeAgentEnv(
    env,
    typeof process !== "undefined" ? process.env : undefined
  )
}
