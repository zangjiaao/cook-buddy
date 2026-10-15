/** Structural subset of D1 used by auth and sync. Matches the Workers binding. */
export type AppD1Result<T = Record<string, unknown>> = {
  results: T[]
  meta: {
    changes: number
    last_row_id: number
  }
}

export type AppD1Statement = {
  bind(...values: unknown[]): AppD1Statement
  all<T = Record<string, unknown>>(): Promise<AppD1Result<T>>
}

export type AppD1Database = {
  prepare(query: string): AppD1Statement
  batch<T = unknown>(statements: AppD1Statement[]): Promise<AppD1Result<T>[]>
  exec(query: string): Promise<unknown>
}
