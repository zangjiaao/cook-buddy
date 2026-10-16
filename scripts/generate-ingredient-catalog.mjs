import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const csvPath = join(root, "src/data/ingredient-catalog.csv")
const outPath = join(root, "src/data/ingredient-catalog.generated.ts")

const GROUPS = [
  "蔬菜",
  "肉禽",
  "水产",
  "蛋奶",
  "豆制品",
  "菌菇",
  "主食",
  "调料",
  "干货",
  "水果",
  "其他",
]
const AISLES = ["meat", "veg", "dry", "seasoning", "other"]
const MODES = ["amount", "presence", "ignore"]
const LOCATIONS = ["fridge", "freezer", "pantry"]

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ""
  let quoted = false
  const source = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1
      row.push(cell)
      cell = ""
      if (row.some((value) => value.trim() !== "")) rows.push(row)
      row = []
      continue
    }
    cell += char
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((value) => value.trim() !== "")) rows.push(row)
  }
  return rows
}

function emptyToNull(value) {
  const text = value.trim()
  return text === "" ? null : text
}

function parseDays(value, label, line) {
  const text = value.trim()
  if (!text) return null
  const days = Number(text)
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`${label} 不是非负整数（第 ${line} 行）`)
  }
  return days
}

function parseConversions(value, line) {
  const text = value.trim()
  if (!text) return {}
  const conversions = {}
  for (const part of text.split("|")) {
    const [unit, factorText] = part.split(":")
    const name = unit?.trim() ?? ""
    const factor = Number(factorText)
    if (!name || !Number.isFinite(factor) || factor <= 0) {
      throw new Error(`换算写错了：${part}（第 ${line} 行）`)
    }
    conversions[name] = factor
  }
  return conversions
}

export function readIngredientCatalog(csv = readFileSync(csvPath, "utf8")) {
  const table = parseCsv(csv)
  const header = table[0]
  const expected = [
    "id",
    "name",
    "aliases",
    "group",
    "family",
    "aisle",
    "accountUnit",
    "purchaseUnit",
    "conversions",
    "quantityMode",
    "defaultLocation",
    "shelfFridge",
    "shelfFreezer",
    "shelfPantry",
  ]
  if (!header || expected.some((key, index) => header[index] !== key)) {
    throw new Error(`表头应为 ${expected.join(",")}`)
  }
  const entries = []
  const seenId = new Set()
  const seenName = new Map()
  for (let index = 1; index < table.length; index += 1) {
    const line = table[index]
    if (line.length === 1 && line[0].trim().startsWith("#")) continue
    if (line.length !== expected.length) {
      throw new Error(`第 ${index + 1} 行应有 ${expected.length} 列，实际 ${line.length}`)
    }
    const [
      id,
      name,
      aliasesText,
      group,
      family,
      aisle,
      accountUnit,
      purchaseUnit,
      conversionsText,
      quantityMode,
      defaultLocation,
      shelfFridge,
      shelfFreezer,
      shelfPantry,
    ] = line
    const recordLine = index + 1
    if (!id.trim() || seenId.has(id.trim())) {
      throw new Error(`id 重复或为空：${id}（第 ${recordLine} 行）`)
    }
    seenId.add(id.trim())
    if (!GROUPS.includes(group.trim())) {
      throw new Error(`分类不对：${group}（第 ${recordLine} 行）`)
    }
    if (!AISLES.includes(aisle.trim())) {
      throw new Error(`大类通道不对：${aisle}（第 ${recordLine} 行）`)
    }
    if (!MODES.includes(quantityMode.trim())) {
      throw new Error(`算量方式不对：${quantityMode}（第 ${recordLine} 行）`)
    }
    if (!LOCATIONS.includes(defaultLocation.trim())) {
      throw new Error(`默认位置不对：${defaultLocation}（第 ${recordLine} 行）`)
    }
    if (!accountUnit.trim() || !purchaseUnit.trim() || !name.trim()) {
      throw new Error(`名称或单位为空（第 ${recordLine} 行）`)
    }
    const aliases = aliasesText
      .split("|")
      .map((alias) => alias.trim())
      .filter(Boolean)
    const names = [name.trim(), ...aliases]
    for (const label of names) {
      const key = label.toLowerCase().replace(/\s+/g, "")
      const previous = seenName.get(key)
      if (previous) {
        throw new Error(`「${label}」同时属于 ${previous} 和 ${name.trim()}`)
      }
      seenName.set(key, name.trim())
    }
    entries.push({
      id: id.trim(),
      name: name.trim(),
      aliases,
      group: group.trim(),
      family: family.trim(),
      aisle: aisle.trim(),
      accountUnit: accountUnit.trim(),
      purchaseUnit: purchaseUnit.trim(),
      conversions: parseConversions(conversionsText, recordLine),
      quantityMode: quantityMode.trim(),
      defaultLocation: defaultLocation.trim(),
      shelfFridge: parseDays(shelfFridge, "冷藏", recordLine),
      shelfFreezer: parseDays(shelfFreezer, "冷冻", recordLine),
      shelfPantry: parseDays(shelfPantry, "常温", recordLine),
    })
  }
  if (entries.length < 200) {
    throw new Error(`基准库至少 200 条，现在 ${entries.length}`)
  }
  return entries
}

export function generateIngredientCatalog() {
  const entries = readIngredientCatalog()
  const body = `/* eslint-disable */
// 由 scripts/generate-ingredient-catalog.mjs 根据 src/data/ingredient-catalog.csv 生成。
// 不要手改。改 CSV 后运行 pnpm generate:catalog。

export const INGREDIENT_CATALOG = ${JSON.stringify(entries, null, 2)} as const
`
  writeFileSync(outPath, body)
  return entries.length
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("generate-ingredient-catalog.mjs")) {
  const count = generateIngredientCatalog()
  console.log(`ingredient catalog: ${count}`)
}
