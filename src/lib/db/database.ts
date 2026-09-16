import { STORE_NAMES } from "@/lib/types"
import type { StoreName } from "@/lib/types"

export const DB_NAME = "cookbuddy"
export const DB_VERSION = 1

const INDEXES: Record<StoreName, Array<{ name: string; keyPath: string }>> = {
  ingredients: [
    { name: "name", keyPath: "name" },
    { name: "category", keyPath: "category" },
  ],
  inventory_items: [
    { name: "ingredientId", keyPath: "ingredientId" },
    { name: "expiresAt", keyPath: "expiresAt" },
    { name: "location", keyPath: "location" },
  ],
  recipes: [{ name: "name", keyPath: "name" }],
  recipe_items: [
    { name: "recipeId", keyPath: "recipeId" },
    { name: "ingredientId", keyPath: "ingredientId" },
  ],
  plan_entries: [
    { name: "date", keyPath: "date" },
    { name: "recipeId", keyPath: "recipeId" },
  ],
  shopping_items: [
    { name: "status", keyPath: "status" },
    { name: "stallHint", keyPath: "stallHint" },
  ],
}

let dbPromise: Promise<IDBDatabase> | null = null

function assertBrowser(): void {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB 仅在浏览器中可用")
  }
}

export function openDatabase(): Promise<IDBDatabase> {
  assertBrowser()
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const storeName of STORE_NAMES) {
          const store = db.objectStoreNames.contains(storeName)
            ? request.transaction!.objectStore(storeName)
            : db.createObjectStore(storeName, { keyPath: "id" })
          for (const index of INDEXES[storeName]) {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, index.keyPath, { unique: false })
            }
          }
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase()
  return requestToPromise(db.transaction(storeName).objectStore(storeName).getAll())
}

export async function getById<T>(
  storeName: StoreName,
  id: string
): Promise<T | undefined> {
  const db = await openDatabase()
  return requestToPromise(db.transaction(storeName).objectStore(storeName).get(id))
}

export async function putRecord<T extends { id: string }>(
  storeName: StoreName,
  value: T
): Promise<T> {
  const db = await openDatabase()
  await requestToPromise(
    db.transaction(storeName, "readwrite").objectStore(storeName).put(value)
  )
  return value
}

export async function removeRecord(storeName: StoreName, id: string): Promise<void> {
  const db = await openDatabase()
  await requestToPromise(
    db.transaction(storeName, "readwrite").objectStore(storeName).delete(id)
  )
}

export async function getByIndex<T>(
  storeName: StoreName,
  indexName: string,
  value: IDBValidKey
): Promise<T[]> {
  const db = await openDatabase()
  return requestToPromise(
    db.transaction(storeName).objectStore(storeName).index(indexName).getAll(value)
  )
}

export async function bulkPut<T extends { id: string }>(
  storeName: StoreName,
  values: T[]
): Promise<void> {
  if (values.length === 0) return
  const db = await openDatabase()
  const store = db.transaction(storeName, "readwrite").objectStore(storeName)
  await Promise.all(values.map((value) => requestToPromise(store.put(value))))
}

export async function countStore(storeName: StoreName): Promise<number> {
  const db = await openDatabase()
  return requestToPromise(db.transaction(storeName).objectStore(storeName).count())
}
