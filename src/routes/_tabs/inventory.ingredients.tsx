import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Field, fieldControlClass } from "@/components/field"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useDb, useQuery } from "@/hooks/use-db"
import { searchIngredients } from "@/lib/ai/match-ingredient"
import { ingredientsRepo, markIngredientRunningLow } from "@/lib/db/repos"
import {
  guessIngredientKind,
  guessPurchaseUnit,
  isStapleIngredient,
} from "@/lib/ingredient-kind"
import { parseAliasText } from "@/lib/ingredient-record"
import {
  categoryLabel,
  ingredientKindLabel,
  MARKET_UNITS,
  PURCHASE_UNITS,
} from "@/lib/labels"
import { CATEGORY_SHELF_LIFE_DAYS } from "@/lib/shelf-life"
import { CATEGORIES, INGREDIENT_KINDS } from "@/lib/types"
import type { Category, Ingredient, IngredientKind } from "@/lib/types"

export const Route = createFileRoute("/_tabs/inventory/ingredients")({
  component: IngredientsPage,
})

function IngredientsPage() {
  const { refresh } = useDb()
  const { data: ingredients, loading } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const [query, setQuery] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [aliases, setAliases] = useState("")
  const [category, setCategory] = useState<Category>("veg")
  const [defaultUnit, setDefaultUnit] = useState("把")
  const [purchaseUnit, setPurchaseUnit] = useState("把")
  const [kind, setKind] = useState<IngredientKind>("fresh")
  const [shelfDays, setShelfDays] = useState("")
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")

  const listed = useMemo(() => {
    if (!query.trim()) {
      return [...ingredients].sort((a, b) => a.name.localeCompare(b.name, "zh"))
    }
    return searchIngredients(query, ingredients, 30).map(
      (row) => row.ingredient
    )
  }, [ingredients, query])

  function startEdit(ingredient: Ingredient) {
    setEditingId(ingredient.id)
    setName(ingredient.name)
    setAliases(ingredient.aliases.join("、"))
    setCategory(ingredient.category)
    setDefaultUnit(ingredient.defaultUnit)
    setKind(
      ingredient.kind ??
        guessIngredientKind(ingredient.name, ingredient.category)
    )
    setPurchaseUnit(
      ingredient.purchaseUnit ??
        guessPurchaseUnit({
          name: ingredient.name,
          category: ingredient.category,
          defaultUnit: ingredient.defaultUnit,
          kind: ingredient.kind,
        })
    )
    setShelfDays(
      ingredient.defaultShelfLifeDays != null
        ? String(ingredient.defaultShelfLifeDays)
        : String(CATEGORY_SHELF_LIFE_DAYS[ingredient.category])
    )
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    const parsedDays = Number(shelfDays)
    await ingredientsRepo.put({
      id: editingId,
      name: name.trim() || "未命名",
      aliases: parseAliasText(aliases),
      category,
      defaultUnit,
      stallHint:
        category === "meat" || category === "veg" || category === "dry"
          ? category
          : null,
      defaultShelfLifeDays: Number.isFinite(parsedDays) ? parsedDays : null,
      kind,
      purchaseUnit,
    })
    refresh()
    setSaving(false)
    setEditingId(null)
  }

  return (
    <>
      <PageHeader
        title="食材档案"
        subtitle="改名字、别名、常备/鲜货和购买单位。加入库存不用先来这里。"
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/inventory" />}
          >
            返回
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <Input
          className="h-12 text-base"
          placeholder="搜食材或别名"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {notice ? (
          <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">读取中…</p>
        ) : null}
        {!loading && ingredients.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            还没有档案。加入库存时写下名字就会自动建，不必先来这里。
          </p>
        ) : null}
        {listed.map((ingredient) => (
          <Card key={ingredient.id}>
            <CardContent className="space-y-3">
              {editingId === ingredient.id ? (
                <>
                  <Field label="名称">
                    <Input
                      className="h-12 text-base"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                  <Field label="别名（顿号或逗号分开）">
                    <Input
                      className="h-12 text-base"
                      value={aliases}
                      onChange={(event) => setAliases(event.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="分类">
                      <select
                        className={fieldControlClass}
                        value={category}
                        onChange={(event) =>
                          setCategory(event.target.value as Category)
                        }
                      >
                        {CATEGORIES.map((item) => (
                          <option key={item} value={item}>
                            {categoryLabel[item]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="默认单位">
                      <select
                        className={fieldControlClass}
                        value={defaultUnit}
                        onChange={(event) => setDefaultUnit(event.target.value)}
                      >
                        {[defaultUnit, ...MARKET_UNITS]
                          .filter(
                            (unit, index, all) => all.indexOf(unit) === index
                          )
                          .map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="常备 / 鲜货">
                      <select
                        className={fieldControlClass}
                        value={kind}
                        onChange={(event) =>
                          setKind(event.target.value as IngredientKind)
                        }
                      >
                        {INGREDIENT_KINDS.map((item) => (
                          <option key={item} value={item}>
                            {ingredientKindLabel[item]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="购买单位">
                      <select
                        className={fieldControlClass}
                        value={purchaseUnit}
                        onChange={(event) =>
                          setPurchaseUnit(event.target.value)
                        }
                      >
                        {[purchaseUnit, ...PURCHASE_UNITS, ...MARKET_UNITS]
                          .filter(
                            (unit, index, all) => all.indexOf(unit) === index
                          )
                          .map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="默认能放（天）">
                    <Input
                      className="h-12 text-base"
                      inputMode="numeric"
                      value={shelfDays}
                      onChange={(event) => setShelfDays(event.target.value)}
                    />
                  </Field>
                  <Button
                    className="h-11 w-full text-base"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    保存
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-11 w-full"
                    onClick={() => setEditingId(null)}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => startEdit(ingredient)}
                  >
                    <p className="text-lg font-medium">{ingredient.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {categoryLabel[ingredient.category]} ·{" "}
                      {
                        ingredientKindLabel[
                          ingredient.kind ??
                            guessIngredientKind(
                              ingredient.name,
                              ingredient.category
                            )
                        ]
                      }{" "}
                      · 买 {ingredient.purchaseUnit ?? ingredient.defaultUnit}
                      {ingredient.aliases.length > 0
                        ? ` · 也叫 ${ingredient.aliases.join("、")}`
                        : ""}
                      {ingredient.defaultShelfLifeDays != null
                        ? ` · 默认 ${ingredient.defaultShelfLifeDays} 天`
                        : ""}
                    </p>
                  </button>
                  {isStapleIngredient(ingredient) ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full text-base"
                      disabled={saving}
                      onClick={() => {
                        void (async () => {
                          setSaving(true)
                          try {
                            const line = await markIngredientRunningLow(
                              ingredient.id
                            )
                            if (line) {
                              setNotice(
                                `已把${ingredient.name} ${line.quantityHint} ${line.unit}加进清单。`
                              )
                            }
                          } finally {
                            setSaving(false)
                          }
                        })()
                      }}
                    >
                      要买
                    </Button>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
