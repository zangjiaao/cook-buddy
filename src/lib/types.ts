export const CATEGORIES = ["meat", "veg", "dry", "seasoning", "other"] as const
export type Category = (typeof CATEGORIES)[number]

export const STALL_HINTS = ["meat", "veg", "dry"] as const
export type StallHint = (typeof STALL_HINTS)[number] | null

export const LOCATIONS = ["fridge", "freezer", "pantry"] as const
export type Location = (typeof LOCATIONS)[number]

export const INVENTORY_STATUSES = ["fresh", "soon", "expired"] as const
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number]

export const MATCH_STATUSES = ["linked", "fuzzy", "unlinked"] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export const SHOPPING_STATUSES = ["needed", "bought"] as const
export type ShoppingStatus = (typeof SHOPPING_STATUSES)[number]

export const SHORTAGE_STATES = ["enough", "short", "unsure"] as const
export type Shortage = (typeof SHORTAGE_STATES)[number]

export const INGREDIENT_KINDS = ["staple", "fresh"] as const
export type IngredientKind = (typeof INGREDIENT_KINDS)[number]

/** 按量扣库存；按有无只记快没了；不管则不进清单也不扣。 */
export const QUANTITY_MODES = ["amount", "presence", "ignore"] as const
export type QuantityMode = (typeof QUANTITY_MODES)[number]

export const SHOPPING_SOURCES = ["plan", "manual", "running_low"] as const
export type ShoppingSource = (typeof SHOPPING_SOURCES)[number]

/** 不确定项的家里判断。have：有，不买；buy：要买，进采购清单。 */
export const PRESENCE_CHOICES = ["have", "buy"] as const
export type PresenceChoice = (typeof PRESENCE_CHOICES)[number]

export const PLAN_ENTRY_STATUSES = ["planned", "cooked"] as const
export type PlanEntryStatus = (typeof PLAN_ENTRY_STATUSES)[number]

export type Ingredient = {
  id: string
  name: string
  aliases: string[]
  category: Category
  defaultUnit: string
  stallHint: StallHint
  defaultShelfLifeDays: number | null
  /** 购买/补货单位：瓶/袋/盒。清单上可以跟记账单位一起显示。 */
  purchaseUnit?: string
  /** 常备调料 vs 鲜货。缺省时按名称/分类推断。 */
  kind?: IngredientKind
  /**
   * 所属大类，如「牛肉」「猪肉」「辣椒」。
   * 牛腩和牛排都是牛肉，但不能当成同义词合并。
   */
  family?: string
  /** false：水、开水这类不用买，不进清单。缺省当 true。 */
  buyable?: boolean
  /** 用户主动载入的示例。没改过时才能在设置里清掉。 */
  sample?: true
  /** 基准库 id。有它才按记账单位换算。 */
  catalogId?: string
  /** 基准库细分分类，例如蔬菜、肉禽。 */
  catalogGroup?: string
  /** 缺省时：常备按有无，不买的食材不管，其余按量。 */
  quantityMode?: QuantityMode
  /** 各位置默认保质期。有值时优先于单一的 defaultShelfLifeDays。 */
  shelfLifeByLocation?: Partial<Record<Location, number>>
  /** 软删后仍指向合并保留的那条，迁移可重入。 */
  mergedInto?: string
  /** 1 个来源单位 = factor 个记账单位。约数记在 approximateUnits。 */
  conversions?: Record<string, number>
  approximateUnits?: string[]
}

export type RecipeSubstitution = {
  /** use：做这道菜时扣替代品；buy：还是买，不再提示。 */
  choice: "use" | "buy"
  substituteIngredientId: string
}

export type InventoryItem = {
  id: string
  ingredientId: string
  quantity: number
  unit: string
  location: Location
  purchasedAt: string
  expiresAt: string | null
  notes: string
  createdAt: string
  updatedAt: string
  /** 换算成记账单位之前的数量，方便对照。 */
  sourceQuantity?: number
  sourceUnit?: string
  /** 对得上基准库，但这条单位换不进去。 */
  unitUnconverted?: boolean
  /** 用户主动载入的示例。没改过时才能在设置里清掉。 */
  sample?: true
}

export type Recipe = {
  id: string
  name: string
  servings: number
  approxMinutes: number | null
  steps: string[]
  /** 与 steps 对齐。空字符串表示这一步没有贴士。 */
  stepTips?: string[]
  createdAt: string
  updatedAt: string
  /** 钉到食谱列表「常做」。缺省当 false。 */
  favorited?: boolean
  /** 最近一次钉上的时间，用来把新钉的排前面。 */
  favoritedAt?: string | null
  /** 固定标签 id，例如 hun / su / tang / zhushi。 */
  tags?: string[]
  /** 用户主动载入的示例。没改过时才能在设置里清掉。 */
  sample?: true
  /** 例如「来自妈妈的分享」。存下来之后和原来的菜互不影响。 */
  sourceLabel?: string
  /** 链接导入时记下的食谱页。 */
  sourceUrl?: string
  /** 录入时的原文，用来重新对齐用量。 */
  sourceText?: string
}

export type RecipeItem = {
  id: string
  recipeId: string
  ingredientId: string | null
  rawName: string
  quantity: number
  unit: string
  matchStatus: MatchStatus
  /** 按这一条用料记住的替代决定。 */
  substitution?: RecipeSubstitution | null
  /** 换算成记账单位之前的数量。 */
  sourceQuantity?: number
  sourceUnit?: string
  /** 数量是约数，例如半只鸡按 0.5 只记。 */
  approximate?: boolean
  /** 分享和重新对齐时用的基准库 id，不带对方的库存。 */
  catalogId?: string
  /** 对得上基准库，但这条单位换不进去。 */
  unitUnconverted?: boolean
  /** 用户主动载入的示例。没改过时才能在设置里清掉。 */
  sample?: true
}

export type SubstituteCandidate = {
  ingredientId: string
  name: string
  quantity: number
  unit: string
}

export type SubstituteOffer = {
  candidates: SubstituteCandidate[]
  recipeItemIds: string[]
}

export type PlanEntry = {
  id: string
  date: string
  rangeKey: string | null
  recipeId: string
  servings: number
  sortOrder: number
  status: PlanEntryStatus
  cookedAt: string | null
  lastDeduct: DeductSnapshot | null
  /** 用户主动载入的示例。没改过时才能在设置里清掉。 */
  sample?: true
}

export type ShoppingItem = {
  id: string
  ingredientId: string | null
  name: string
  quantityHint: string
  unit: string
  stallHint: StallHint
  status: ShoppingStatus
  shortage: Shortage
  fromPlanEntryIds: string[]
  checkedAt: string | null
  neededQty?: number | null
  stockQty?: number | null
  buyQty?: number | null
  contextHint?: string
  /** 计划差额 / 手加 / 快没了。重算时保留后两者。 */
  source?: ShoppingSource
  /** 自家没有这味，但有同大类库存时的替代提示。 */
  substituteOffer?: SubstituteOffer
  /**
   * 不确定时用户的判断。重算保留。
   * 存在购物项正文里，靠 updatedAt 同步，删除仍走软删除。
   */
  presenceChoice?: PresenceChoice | null
  /** 采购时改过的实际数量，优先于计划差额。不改 unit，避免打乱合并键。 */
  pickedQty?: number | null
  /** 采购时改过的实际单位。 */
  pickedUnit?: string | null
  /** 记账单位之外的采购说法，例如「约 1.5 斤」。 */
  purchaseHint?: string
  /** 单位换不进记账单位，数量没有和别的单位合并。 */
  unitUnconverted?: boolean
  /** 这条按基准库记账单位汇总。重算时用，不展示。 */
  catalogTracked?: boolean
  /** 用户主动载入的示例。没改过时才能在设置里清掉。 */
  sample?: true
}

export type DeductSnapshot = {
  at: string
  recipeId: string
  servings: number
  planEntryId: string
  changes: Array<{
    inventoryItemId: string
    previousQuantity: number
    nextQuantity: number
    /** 扣之前的单位。撤销时一并还原。 */
    previousUnit?: string
    nextUnit?: string
  }>
  /** 这次勾了「快没了」的食材。 */
  runningLowIngredientIds?: string[]
  /** 这次新建的快没了清单行，撤销时软删。 */
  runningLowCreatedIds?: string[]
}

export type DeductOutcome =
  | { ok: true; snapshot: DeductSnapshot }
  | { ok: false; reason: "already_cooked" | "in_progress" | "missing_entry" }

export const STORE_NAMES = [
  "ingredients",
  "inventory_items",
  "recipes",
  "recipe_items",
  "plan_entries",
  "shopping_items",
] as const

export type StoreName = (typeof STORE_NAMES)[number]
