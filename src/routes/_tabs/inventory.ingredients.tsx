import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Field, fieldControlClass } from "@/components/field"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useDb, useQuery } from "@/hooks/use-db"
import { searchIngredients } from "@/lib/ai/match-ingredient"
import { ingredientsRepo } from "@/lib/db/repos"
import { parseAliasText } from "@/lib/ingredient-record"
import { categoryLabel, MARKET_UNITS } from "@/lib/labels"
import { CATEGORY_SHELF_LIFE_DAYS } from "@/lib/shelf-life"
import { CATEGORIES } from "@/lib/types"
import type { Category, Ingredient } from "@/lib/types"

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
  const [shelfDays, setShelfDays] = useState("")
  const [saving, setSaving] = useState(false)

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
    })
    refresh()
    setSaving(false)
    setEditingId(null)
  }

  return (
    <>
      <PageHeader
        title="食材主数据"
        subtitle="改名字或别名，清单就能对上。小葱也可以叫葱。"
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
        {loading ? (
          <p className="text-sm text-muted-foreground">读取中…</p>
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
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => startEdit(ingredient)}
                >
                  <p className="text-lg font-medium">{ingredient.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {categoryLabel[ingredient.category]} ·{" "}
                    {ingredient.defaultUnit}
                    {ingredient.aliases.length > 0
                      ? ` · 也叫 ${ingredient.aliases.join("、")}`
                      : ""}
                    {ingredient.defaultShelfLifeDays != null
                      ? ` · 默认 ${ingredient.defaultShelfLifeDays} 天`
                      : ""}
                  </p>
                </button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
