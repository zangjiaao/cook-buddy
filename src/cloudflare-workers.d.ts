declare module "cloudflare:workers" {
  interface AppD1Statement {
    bind(...values: unknown[]): AppD1Statement
    all<T = Record<string, unknown>>(): Promise<{
      results: T[]
      meta: { changes: number; last_row_id: number }
    }>
  }

  interface AppD1Database {
    prepare(query: string): AppD1Statement
    batch<T = unknown>(
      statements: AppD1Statement[]
    ): Promise<
      Array<{
        results: T[]
        meta: { changes: number; last_row_id: number }
      }>
    >
    exec(query: string): Promise<unknown>
  }

  // Secrets are runtime bindings, not build variables.
  export const env: {
    DB?: AppD1Database
    BETTER_AUTH_SECRET?: string
    BETTER_AUTH_URL?: string
    DEEPSEEK_API_KEY?: string
    DEEPSEEK_BASE_URL?: string
    DEEPSEEK_MODEL?: string
  }
}
