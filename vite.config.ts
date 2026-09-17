import { defineConfig, loadEnv } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

function applyDeepSeekEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), "")
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("DEEPSEEK_") && process.env[key] == null) {
      process.env[key] = value
    }
  }
}

const config = defineConfig(({ mode }) => {
  applyDeepSeekEnv(mode)
  return {
    resolve: { tsconfigPaths: true },
    plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  }
})

export default config
