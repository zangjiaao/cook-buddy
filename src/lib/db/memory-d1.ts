import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import type { AppD1Database, AppD1Result, AppD1Statement } from "@/lib/db/d1"

function toPlain(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {}
  return { ...(row as Record<string, unknown>) }
}

/** In-memory D1 backed by node:sqlite, for auth and sync tests. */
export function createMemoryD1(): AppD1Database {
  const db = new DatabaseSync(":memory:")

  function statement(sql: string): AppD1Statement {
    let params: unknown[] = []
    const api: AppD1Statement = {
      bind(...values: unknown[]) {
        params = values
        return api
      },
      async all<T>() {
        const rows = db
          .prepare(sql)
          .all(...params)
          .map((row) => toPlain(row) as T)
        const meta = toPlain(
          db
            .prepare("select changes() as changes, last_insert_rowid() as id")
            .get()
        )
        const result: AppD1Result<T> = {
          results: rows,
          meta: {
            changes: Number(meta.changes ?? 0),
            last_row_id: Number(meta.id ?? 0),
          },
        }
        return result
      },
    }
    return api
  }

  return {
    prepare(sql: string) {
      return statement(sql)
    },
    async batch<T>(statements: AppD1Statement[]) {
      const results: AppD1Result<T>[] = []
      for (const stmt of statements) {
        results.push(await stmt.all())
      }
      return results
    },
    async exec(sql: string) {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
  }
}

export async function applyMigrationFiles(
  db: AppD1Database,
  paths: string[]
): Promise<void> {
  for (const path of paths) {
    await db.exec(readFileSync(path, "utf8"))
  }
}
