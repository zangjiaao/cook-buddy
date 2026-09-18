import { defineConfig, loadEnv } from "vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

function applyDeepSeekEnv(mode: string) {
  // loadEnv picks up `.env.local` / `.env.[mode].local` without exposing
  // DEEPSEEK_* to the client bundle (we only copy into process.env).
  const env = loadEnv(mode, process.cwd(), "")
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("DEEPSEEK_") && process.env[key] == null) {
      process.env[key] = value
    }
  }
}

const config = defineConfig(({ mode }) => {
  applyDeepSeekEnv(mode)
  // Vitest loads this config; the Workers plugin expects workerd, not unit tests.
  const workersAdapter = process.env.VITEST
    ? []
    : [cloudflare({ viteEnvironment: { name: "ssr" } })]
  return {
    resolve: { tsconfigPaths: true },
    plugins: [
      devtools(),
      tailwindcss(),
      ...workersAdapter,
      tanstackStart(),
      viteReact(),
    ],
  }
})

export default config
