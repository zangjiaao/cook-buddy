import { normalizeIngredient } from "@/lib/ingredient-kind"
import { CATEGORY_SHELF_LIFE_DAYS } from "@/lib/shelf-life"
import { stallFromCategory } from "@/lib/shopping-from-plan"
import type { Category, Ingredient, Location } from "@/lib/types"

/**
 * 规则表：先匹配更具体的名字。没命中返回 null，交给 AI；
 * 没有 AI 时调用方归入「其他」，不要再默认蔬菜。
 */
const VEG_EXCEPTIONS_RE =
  /木耳菜|鸡毛菜|鱼腥草|蒜苗|蒜苔|蒜薹|青蒜|蒜黄|洋姜|油菜|油麦菜|毛豆/

const DRY_RE =
  /紫菜|海带|昆布|虾皮|海米|干贝|瑶柱|腐竹|豆腐干|香干|豆干|豆皮|粉丝|粉条|木耳|银耳|香菇|茶树菇|花菇|红枣|枸杞|莲子|桂圆|笋干|黄花菜|干辣椒|辣椒干|淀粉|生粉|玉米淀粉|玉米面|玉米粉|玉米糁|面粉|糯米粉|奶粉|花生米|花生|大米|小米|糯米|黑米|香米|糙米|燕麦|意面|意大利面|通心粉|挂面|面条|米粉|河粉|年糕|藜麦|黄豆|红豆|绿豆|黑豆|芸豆|杂粮/

const SEASONING_RE =
  /生抽|老抽|酱油|味极鲜|豉油|醋|料酒|黄酒|花雕|蚝油|鱼露|虾酱|豆瓣|甜面酱|黄豆酱|海鲜酱|柱候|沙茶|番茄酱|沙拉|芝麻酱|辣椒酱|蒜蓉酱|腐乳|豆豉|老干妈|火锅底料|底料|五香|十三香|孜然|咖喱|花椒|胡椒|八角|大料|桂皮|香叶|草果|丁香|茴香|卤料|味精|鸡精|鸡粉|盐|糖|芝麻油|香油|芥末|味噌|味增|辣酱|藤椒|椒盐|辣椒粉|辣椒面|辣椒油|蒜蓉|蒜泥|蒜末|蒜瓣|蒜头|大蒜|生姜|老姜|嫩姜|姜片|姜丝|姜末|调料|香料|榨菜|酱菜|泡菜|酸菜|咸菜|雪里蕻|芽菜|芝麻/

const FRESH_DAIRY_RE =
  /牛奶|酸奶|鲜奶|纯奶|奶酪|芝士|黄油|奶油|炼乳|淡奶油|乳酪/

const EGG_RE = /鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋|皮蛋|松花蛋|咸蛋|茶叶蛋|蛋清|蛋黄/

const MEAT_RE =
  /肉|猪|牛|羊|鸡|鸭|鹅|排骨|五花|虾|鱼|蟹|贝|鱿|墨鱼|章鱼|火腿|培根|香肠|腊肉|腊肠|肉松|里脊|肥肠|鸡翅|鸡腿|鸡胸|鸭掌|牛蛙|甲鱼|黄鳝|泥鳅|生蚝|牡蛎|蛤蜊|花甲|蛏/

const VEG_RE =
  /菜$|葱$|白菜|菠菜|生菜|韭菜|芹菜|黄瓜|番茄|西红柿|蕃茄|圣女果|土豆|马铃薯|洋芋|萝卜|莲藕|藕|山药|芋|洋葱|茄子|辣椒|青椒|红椒|尖椒|杭椒|线椒|小米辣|朝天椒|灯笼椒|甜椒|柿子椒|冬瓜|南瓜|丝瓜|苦瓜|西葫芦|豆角|四季豆|荷兰豆|豌豆|芦笋|竹笋|笋|西兰花|西蓝花|花椰菜|花菜|菜花|金针菇|平菇|杏鲍菇|口蘑|蘑菇|菌菇|豆芽|豆腐|千张|莴笋|莴苣|空心菜|油麦|上海青|大葱|小葱|香葱|玉米|秋葵|佛手瓜|葫芦|苋菜|茼蒿|香菜|芫荽|地瓜|红薯|紫薯|白薯|番薯|芥蓝|盖菜|娃娃菜|包菜|卷心菜|甘蓝|菜心|茭白|慈姑|茨菇|荸荠|马蹄|蚕豆|刀豆|豇豆|西芹|苹果|梨|香蕉|橙|橘|柑|柠檬|葡萄|草莓|西瓜|哈密瓜|桃|芒果|猕猴桃|火龙果|柚|百合/

function cleaned(rawName: string): string {
  return rawName.trim().replace(/\s+/g, "")
}

function isSeasoning(name: string): boolean {
  if (FRESH_DAIRY_RE.test(name)) return false
  if (/油$/.test(name)) return true
  if (/^(蒜|姜)$/.test(name) || /姜$/.test(name)) return true
  return SEASONING_RE.test(name)
}

export function classifyByRules(rawName: string): Category | null {
  const name = cleaned(rawName)
  if (!name) return null
  if (VEG_EXCEPTIONS_RE.test(name)) return "veg"
  if (isSeasoning(name)) return "seasoning"
  if (DRY_RE.test(name)) return "dry"
  if (FRESH_DAIRY_RE.test(name)) return "other"
  if (EGG_RE.test(name) || MEAT_RE.test(name)) return "meat"
  if (VEG_RE.test(name)) return "veg"
  return null
}

/** 规则命中用规则；没命中归入「其他」，绝不默认蔬菜。 */
export function guessCategory(rawName: string): Category {
  return classifyByRules(rawName) ?? "other"
}

export function defaultLocationForCategory(category: Category): Location {
  if (category === "dry" || category === "seasoning" || category === "other") {
    return "pantry"
  }
  return "fridge"
}

export function placementForName(
  rawName: string,
  category: Category
): { location: Location; shelfLifeDays: number } {
  if (FRESH_DAIRY_RE.test(cleaned(rawName))) {
    return { location: "fridge", shelfLifeDays: 7 }
  }
  return {
    location: defaultLocationForCategory(category),
    shelfLifeDays: CATEGORY_SHELF_LIFE_DAYS[category],
  }
}

export function patchIngredientCategory(
  ingredient: Ingredient,
  category: Category
): Ingredient {
  if (ingredient.category === category) return ingredient
  const previousDefault = CATEGORY_SHELF_LIFE_DAYS[ingredient.category]
  const keepShelf =
    ingredient.defaultShelfLifeDays != null &&
    ingredient.defaultShelfLifeDays !== previousDefault
  const placement = placementForName(ingredient.name, category)
  return normalizeIngredient({
    ...ingredient,
    category,
    stallHint: stallFromCategory(category),
    defaultShelfLifeDays: keepShelf
      ? ingredient.defaultShelfLifeDays
      : placement.shelfLifeDays,
  })
}

/** 只修正被误标成蔬菜、且规则能确定不是蔬菜的档案。 */
export function correctMisfiledVegetable(ingredient: Ingredient): Ingredient {
  if (ingredient.category !== "veg") return ingredient
  const ruled = classifyByRules(ingredient.name)
  if (!ruled || ruled === "veg") return ingredient
  return patchIngredientCategory(ingredient, ruled)
}
