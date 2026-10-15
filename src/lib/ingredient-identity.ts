import type { Category, Ingredient } from "@/lib/types"

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

/** 同一种买菜物的不同叫法。组里第一个是偏好的档案名。 */
const SYNONYM_GROUPS: readonly string[][] = [
  ["西红柿", "番茄", "蕃茄"],
  ["土豆", "马铃薯", "洋芋"],
  ["青菜", "小白菜"],
  ["紫菜", "干紫菜", "紫菜干"],
  ["香菜", "芫荽"],
  ["蒜苗", "青蒜"],
  ["小葱", "香葱", "青葱"],
  ["鸡蛋", "鸡子"],
]

/**
 * 具体部位 / 品种所属的大类。
 * 这些不是同义词：能不能拿来替，要看这道菜，清单里只提示。
 */
const FAMILY_MEMBERS: ReadonlyArray<{
  family: string
  names: readonly string[]
}> = [
  {
    family: "牛肉",
    names: [
      "牛肉",
      "牛腩",
      "牛排",
      "牛里脊",
      "牛腱",
      "牛腱子",
      "肥牛",
      "牛柳",
      "牛霖",
    ],
  },
  {
    family: "猪肉",
    names: [
      "猪肉",
      "五花肉",
      "猪肉馅",
      "肉馅",
      "猪里脊",
      "里脊",
      "里脊肉",
      "排骨",
      "肋排",
      "梅花肉",
      "前腿肉",
      "后腿肉",
      "瘦肉",
    ],
  },
  {
    family: "羊肉",
    names: ["羊肉", "羊排", "羊腿", "羊肉馅"],
  },
  {
    family: "鸡肉",
    names: ["鸡肉", "鸡腿", "鸡翅", "鸡胸", "鸡胸肉", "大公鸡", "整鸡", "鸡块"],
  },
  {
    family: "鸭肉",
    names: ["鸭肉", "鸭腿", "鸭翅"],
  },
  {
    family: "鱼",
    names: [
      "鱼",
      "鱼肉",
      "黑鱼",
      "鲈鱼",
      "鲫鱼",
      "草鱼",
      "带鱼",
      "龙利鱼",
      "巴沙鱼",
    ],
  },
  {
    family: "虾",
    names: ["虾", "虾仁", "大虾", "基围虾", "明虾"],
  },
  {
    family: "辣椒",
    names: [
      "辣椒",
      "青椒",
      "红椒",
      "小米辣",
      "尖椒",
      "杭椒",
      "线椒",
      "朝天椒",
      "灯笼椒",
      "甜椒",
      "柿子椒",
    ],
  },
]

const NON_PURCHASABLE_RE =
  /^(水|开水|清水|热水|凉水|冷水|温水|冰水|自来水|饮用水|凉白开|白开水)$/

const POWDER_RE = /盐|白糖|冰糖|味精|鸡精|淀粉|小苏打|面粉|胡椒粉|花椒粉|五香粉/
const BOTTLE_RE = /老抽|生抽|酱油|香醋|陈醋|米醋|料酒|蚝油|香油|芝麻油|食用油/
const PIECE_RE = /番茄|西红柿|蕃茄|洋葱|土豆|马铃薯|鸡蛋|黄瓜|苹果|梨/
const BLOCK_RE = /牛排|排骨|肋排|鸡块/
const WHOLE_RE = /大公鸡|整鸡|全鸡/

export function isNonPurchasableName(name: string): boolean {
  return NON_PURCHASABLE_RE.test(norm(name))
}

export function synonymGroupKey(name: string): string | undefined {
  const needle = norm(name)
  if (!needle) return undefined
  for (const group of SYNONYM_GROUPS) {
    if (group.some((entry) => norm(entry) === needle)) return norm(group[0])
  }
  return undefined
}

export function samePantryIdentity(left: string, right: string): boolean {
  const a = norm(left)
  const b = norm(right)
  if (!a || !b) return false
  if (a === b) return true
  const groupA = synonymGroupKey(left)
  const groupB = synonymGroupKey(right)
  return Boolean(groupA && groupB && groupA === groupB)
}

export function guessFamily(name: string): string | undefined {
  const needle = norm(name)
  if (!needle) return undefined
  let best: { family: string; length: number } | undefined
  for (const group of FAMILY_MEMBERS) {
    for (const member of group.names) {
      const token = norm(member)
      if (!token) continue
      const hit = needle === token || needle.startsWith(token)
      if (!hit) continue
      if (!best || token.length > best.length) {
        best = { family: group.family, length: token.length }
      }
    }
  }
  return best?.family
}

export function ingredientFamily(
  ingredient: Pick<Ingredient, "name" | "family">
): string | undefined {
  const explicit = ingredient.family?.trim()
  if (explicit) return explicit
  return guessFamily(ingredient.name)
}

export function sameFamilyDifferentThing(left: string, right: string): boolean {
  if (samePantryIdentity(left, right)) return false
  const familyA = guessFamily(left)
  const familyB = guessFamily(right)
  return Boolean(familyA && familyB && familyA === familyB)
}

export function isFamilyLabelAlias(
  name: string,
  alias: string,
  family?: string
): boolean {
  const label = family?.trim() || guessFamily(name)
  if (!label) return false
  if (norm(alias) !== norm(label)) return false
  if (norm(alias) === norm(name)) return false
  if (samePantryIdentity(name, alias)) return false
  return true
}

export function isBlockedAlias(
  ingredient: Pick<Ingredient, "name" | "family">,
  alias: string
): boolean {
  if (isFamilyLabelAlias(ingredient.name, alias, ingredient.family)) return true
  return sameFamilyDifferentThing(ingredient.name, alias)
}

export function linkableAliases(
  ingredient: Pick<Ingredient, "name" | "aliases" | "family">
): string[] {
  return ingredient.aliases.filter(
    (alias) => !isBlockedAlias(ingredient, alias)
  )
}

export function familyMemberRank(family: string, name: string): number {
  const group = FAMILY_MEMBERS.find((entry) => entry.family === family)
  if (!group) return 100
  const needle = norm(name)
  const index = group.names.findIndex((member) => {
    const token = norm(member)
    return needle === token || needle.startsWith(token)
  })
  return index === -1 ? 80 : index
}

/**
 * 有把握时给出默认/采购单位。没有把握就返回 undefined，让叶菜继续用「把」。
 */
export function confidentUnit(
  name: string,
  _category?: Category
): string | undefined {
  const text = name.trim()
  if (!text || isNonPurchasableName(text)) return undefined
  if (POWDER_RE.test(text)) return "袋"
  if (BOTTLE_RE.test(text) || text === "油" || text === "醋") return "瓶"
  if (PIECE_RE.test(text)) return "个"
  if (WHOLE_RE.test(text)) return "只"
  if (BLOCK_RE.test(text)) return "块"
  if (/馅/.test(text)) return "袋"
  if (/鱼|虾/.test(text)) return "斤"
  if (/牛|猪|羊|鸡|鸭|肉/.test(text)) return "斤"
  return undefined
}

export function correctedUnit(
  name: string,
  category: Category | undefined,
  unit: string | undefined
): string | undefined {
  const current = unit?.trim() ?? ""
  const next = confidentUnit(name, category)
  if (!next || !current || current === next) return undefined
  if (current === "把") return next
  return undefined
}
