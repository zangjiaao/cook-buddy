import type {
  Category,
  InventoryStatus,
  Location,
  MatchStatus,
  PlanEntryStatus,
  Shortage,
  StallHint,
} from "@/lib/types"

export const categoryLabel: Record<Category, string> = {
  meat: "肉",
  veg: "菜",
  dry: "干货",
  seasoning: "调味",
}

export const stallLabel: Record<Exclude<StallHint, null>, string> = {
  meat: "肉档",
  veg: "菜摊",
  dry: "干货",
}

export function stallText(hint: StallHint): string {
  return hint ? stallLabel[hint] : "未分摊"
}

export const locationLabel: Record<Location, string> = {
  fridge: "冰箱",
  freezer: "冷冻",
  pantry: "柜子",
}

export const inventoryStatusLabel: Record<InventoryStatus, string> = {
  fresh: "新鲜",
  soon: "临期",
  expired: "过期",
}

export const shortageLabel: Record<Shortage, string> = {
  enough: "够",
  short: "不够",
  unsure: "不确定",
}

export const matchStatusLabel: Record<MatchStatus, string> = {
  linked: "已对齐",
  fuzzy: "可能是这个",
  unlinked: "未对齐",
}

export const planEntryStatusLabel: Record<PlanEntryStatus, string> = {
  planned: "待做",
  cooked: "已做",
}

export const MARKET_UNITS = [
  "个",
  "把",
  "盒",
  "袋",
  "瓶",
  "斤",
  "克",
  "头",
  "瓣",
  "勺",
  "块",
]
