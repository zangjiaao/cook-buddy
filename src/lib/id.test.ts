import { afterEach, describe, expect, test, vi } from "vitest"
import { createId } from "@/lib/id"

const UUID_TAIL =
  /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("createId", () => {
  test("优先用 crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
    })
    expect(createId("inv")).toBe("inv-11111111-2222-4333-8444-555555555555")
  })

  test("randomUUID 不是函数时用 getRandomValues 拼 UUID", () => {
    const stub = {
      getRandomValues(array: Uint8Array) {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = index + 1
        }
        return array
      },
    }
    vi.stubGlobal("crypto", stub)

    expect(typeof globalThis.crypto.randomUUID).not.toBe("function")
    const id = createId("inv")
    expect(id).toMatch(new RegExp(`^inv-${UUID_TAIL.source}$`))
  })

  test("没有 Web Crypto 时仍能生成本地 id", () => {
    vi.stubGlobal("crypto", undefined)
    vi.spyOn(Math, "random").mockReturnValueOnce(0.11).mockReturnValueOnce(0.22)
    const first = createId("inv")
    const second = createId("inv")
    expect(first.startsWith("inv-")).toBe(true)
    expect(second.startsWith("inv-")).toBe(true)
    expect(first).not.toBe(second)
  })
})
