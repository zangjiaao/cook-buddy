export type RecipeDraftItem = {
  rawName: string
  quantity: number
  unit: string
}

export type RecipeDraftSource = "ai" | "rule" | "mock"

export type RecipeDraft = {
  name: string
  servings: number
  approxMinutes: number | null
  steps: string[]
  items: RecipeDraftItem[]
  source: RecipeDraftSource
}

export type RecipeParser = {
  id: string
  parse: (text: string) => Promise<RecipeDraft>
}

const ITEM_LINE =
  /^[-*·\d.、)）]*\s*(.+?)\s+(\d+(?:\.\d+)?)\s*([个把盒袋瓶斤克头瓣勺块毫升]?)/

const FUZZY_UNITS = /^(少许|适量|若干)$/

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseItemLine(line: string): RecipeDraftItem | null {
  const cleaned = line.replace(/^[-*·\d.、)）]+\s*/, "")
  const match = cleaned.match(ITEM_LINE) ?? line.match(ITEM_LINE)
  if (!match) return null
  return {
    rawName: match[1].replace(/[:：]/g, "").trim(),
    quantity: Number(match[2]),
    unit: match[3] || "个",
  }
}

export function ruleParse(text: string): RecipeDraft {
  const lines = nonEmptyLines(text)
  const name = lines[0]?.replace(/^#\s*/, "") || "未命名食谱"
  const joined = text.replace(/\s+/g, " ")
  const servingsMatch = joined.match(/(\d+)\s*人/)
  const minutesMatch = joined.match(/(\d+)\s*分钟/)

  const ingredientStart = lines.findIndex((line) => /食材|材料|用料/.test(line))
  const stepStart = lines.findIndex((line) => /步骤|做法|料理/.test(line))

  const itemLines =
    ingredientStart >= 0
      ? lines.slice(
          ingredientStart + 1,
          stepStart > ingredientStart ? stepStart : undefined
        )
      : lines.slice(1)

  const items = itemLines
    .map(parseItemLine)
    .filter((item): item is RecipeDraftItem => item !== null)

  const stepLines =
    stepStart >= 0
      ? lines.slice(stepStart + 1)
      : lines.filter((line) => /^\d+[.、)）]/.test(line))

  const steps = stepLines
    .map((line) => line.replace(/^\d+[.、)）]\s*/, "").trim())
    .filter((line) => line && !parseItemLine(line))

  return {
    name,
    servings: servingsMatch ? Number(servingsMatch[1]) : 2,
    approxMinutes: minutesMatch ? Number(minutesMatch[1]) : null,
    steps,
    items,
    source: "rule",
  }
}

export function mockParse(text: string): RecipeDraft {
  const lines = nonEmptyLines(text)
  return {
    name: lines[0] || "未命名食谱",
    servings: 2,
    approxMinutes: 20,
    items: [{ rawName: "待校对食材", quantity: 1, unit: "份" }],
    steps:
      lines.slice(1).length > 0
        ? lines.slice(1)
        : ["把粘贴内容拆成步骤后确认。"],
    source: "mock",
  }
}

export function fallbackParse(text: string): RecipeDraft {
  const draft = ruleParse(text)
  if (draft.items.length > 0 || draft.steps.length > 0) return draft
  return mockParse(text)
}

export const defaultParser: RecipeParser = {
  id: "rule-then-mock",
  async parse(text: string) {
    return fallbackParse(text)
  },
}

export async function parseRecipeText(
  text: string,
  parser: RecipeParser = defaultParser
): Promise<RecipeDraft> {
  return parser.parse(text)
}

export function recipeDraftSourceLabel(source: RecipeDraftSource): string {
  if (source === "ai") return "AI 抽出"
  if (source === "rule") return "规则抽出"
  return "本地 mock 草稿"
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error("empty json")
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start < 0 || end <= start) {
    throw new Error("no json object")
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readPositiveInt(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.round(number)
}

function readApproxMinutes(value: unknown): number | null {
  if (value == null || value === "") return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number)
}

export function normalizeDraftItem(raw: unknown): RecipeDraftItem | null {
  const record = asRecord(raw)
  if (!record) return null
  const rawName = String(record.rawName ?? record.name ?? "")
    .replace(/[:：]/g, "")
    .trim()
  if (!rawName) return null

  const quantityRaw = record.quantity
  let unit = String(record.unit ?? "").trim()
  let quantity = Number(quantityRaw)

  if (typeof quantityRaw === "string" && FUZZY_UNITS.test(quantityRaw.trim())) {
    unit = quantityRaw.trim()
    quantity = 1
  }

  if (!unit) unit = "个"
  if (FUZZY_UNITS.test(unit) && (!Number.isFinite(quantity) || quantity <= 0)) {
    quantity = 1
  }
  if (!Number.isFinite(quantity) || quantity < 0) quantity = 1

  return { rawName, quantity, unit }
}

export function normalizeRecipeDraft(
  raw: unknown,
  source: RecipeDraftSource = "ai"
): RecipeDraft | null {
  const record = asRecord(raw)
  if (!record) return null
  const name = String(record.name ?? "").trim()
  if (!name) return null

  const itemsRaw = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.ingredients)
      ? record.ingredients
      : []
  const items = itemsRaw
    .map(normalizeDraftItem)
    .filter((item): item is RecipeDraftItem => item !== null)

  const stepsRaw = Array.isArray(record.steps) ? record.steps : []
  const steps = stepsRaw.map((step) => String(step).trim()).filter(Boolean)

  if (items.length === 0 && steps.length === 0) return null

  return {
    name,
    servings: readPositiveInt(record.servings, 2),
    approxMinutes: readApproxMinutes(record.approxMinutes),
    items,
    steps,
    source,
  }
}

export function tryParseRecipeDraftJson(
  text: string,
  source: RecipeDraftSource = "ai"
): RecipeDraft | null {
  try {
    return normalizeRecipeDraft(extractJsonObject(text), source)
  } catch {
    return null
  }
}
