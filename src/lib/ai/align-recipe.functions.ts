import { createServerFn } from "@tanstack/react-start"
import { alignRecipeWithAi } from "@/lib/ai/align-recipe.server"
import type { AlignRecipePayload } from "@/lib/ai/align-recipe"
import { readDeepSeekRuntimeEnv } from "@/lib/ai/worker-env"
import type { Category } from "@/lib/types"

const CATEGORIES = new Set<Category>([
  "meat",
  "veg",
  "dry",
  "seasoning",
  "other",
])

function readPayload(data: unknown): AlignRecipePayload {
  if (!data || typeof data !== "object") throw new Error("对齐内容不对")
  const record = data as AlignRecipePayload
  if (!Array.isArray(record.lines) || !Array.isArray(record.stock)) {
    throw new Error("对齐内容不对")
  }
  return {
    ...(typeof record.sourceText === "string"
      ? { sourceText: record.sourceText.slice(0, 8000) }
      : {}),
    lines: record.lines.slice(0, 80).map((line) => ({
      key: typeof line.key === "string" ? line.key.slice(0, 80) : undefined,
      rawName: String(line.rawName ?? "").slice(0, 40),
      quantity: Number(line.quantity) || 0,
      unit: String(line.unit ?? "").slice(0, 8),
      ...(typeof line.catalogId === "string"
        ? { catalogId: line.catalogId.slice(0, 40) }
        : {}),
    })),
    stock: record.stock.slice(0, 400).map((row) => ({
      id: String(row.id ?? "").slice(0, 80),
      name: String(row.name ?? "").slice(0, 40),
      aliases: Array.isArray(row.aliases)
        ? row.aliases.slice(0, 8).map((alias) => String(alias).slice(0, 40))
        : [],
      ...(typeof row.catalogId === "string"
        ? { catalogId: row.catalogId.slice(0, 40) }
        : {}),
      defaultUnit: String(row.defaultUnit ?? "").slice(0, 8),
      inStock: Boolean(row.inStock),
      ...(row.conversions && typeof row.conversions === "object"
        ? { conversions: row.conversions }
        : {}),
      ...(Array.isArray(row.approximateUnits)
        ? {
            approximateUnits: row.approximateUnits
              .slice(0, 8)
              .map((unit) => String(unit).slice(0, 8)),
          }
        : {}),
      category: CATEGORIES.has(row.category) ? row.category : "other",
    })),
  }
}

export const alignRecipe = createServerFn({ method: "POST" })
  .validator((data: unknown) => readPayload(data))
  .handler(async ({ data }) => {
    return alignRecipeWithAi(data, { env: readDeepSeekRuntimeEnv() })
  })
