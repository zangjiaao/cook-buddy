import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

describe("service worker cache", () => {
  test("does not cache auth or server function responses", () => {
    const source = readFileSync(
      new URL("../../public/sw.js", import.meta.url),
      "utf8"
    )
    expect(source).toContain('url.pathname.startsWith("/api/")')
    expect(source).toContain('request.headers.has("x-tsr-serverFn")')
    expect(source).toContain('const CACHE_NAME = "cookbuddy-v3"')
  })
})
