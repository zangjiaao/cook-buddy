declare module "cloudflare:workers" {
  // Secrets like DEEPSEEK_* are set in the dashboard, not wrangler.jsonc.
  export const env: Record<string, string | undefined>
}
