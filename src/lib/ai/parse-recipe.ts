export type RecipeDraftItem = {
  rawName: string
  quantity: number
  unit: string
}

export type RecipeDraft = {
  name: string
  servings: number
  approxMinutes: number | null
  steps: string[]
  items: RecipeDraftItem[]
  source: "rule" | "mock"
}

export type RecipeParser = {
  id: string
  parse: (text: string) => Promise<RecipeDraft>
}

const ITEM_LINE =
  /^[-*·\d.、)）]*\s*(.+?)\s+(\d+(?:\.\d+)?)\s*([个把盒袋瓶斤克头瓣勺块毫升]?)/

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
    steps: lines.slice(1).length > 0 ? lines.slice(1) : ["把粘贴内容拆成步骤后确认。"],
    source: "mock",
  }
}

export const defaultParser: RecipeParser = {
  id: "rule-then-mock",
  async parse(text: string) {
    const draft = ruleParse(text)
    if (draft.items.length > 0 || draft.steps.length > 0) return draft
    return mockParse(text)
  },
}

export async function parseRecipeText(
  text: string,
  parser: RecipeParser = defaultParser
): Promise<RecipeDraft> {
  return parser.parse(text)
}
