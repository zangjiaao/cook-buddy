import { describe, expect, test } from "vitest"
import { publicHttpUrlError, sanitizeStoredSourceUrl } from "@/lib/source-url"

describe("publicHttpUrlError", () => {
  test("允许公开的 http(s)", () => {
    expect(publicHttpUrlError("https://recipes.example/hongshaorou")).toBeNull()
    expect(sanitizeStoredSourceUrl("https://recipes.example/a#step")).toBe(
      "https://recipes.example/a"
    )
  })

  test("拒绝内网、本机、奇怪写法和非网页协议", () => {
    const blocked = [
      "http://127.0.0.1/admin",
      "http://localhost/x",
      "http://10.1.2.3/",
      "http://192.168.1.5/recipe",
      "http://172.16.5.5/",
      "http://169.254.169.254/latest",
      "http://[::1]/",
      "http://[fc00::1]/",
      "http://2130706433/",
      "http://127.1/",
      "http://0x7f000001/",
      "http://127.0.0.1.nip.io/recipe",
      "file:///etc/passwd",
      "http://user:pass@example.com/",
      "javascript:alert(1)",
    ]
    for (const url of blocked) {
      expect(publicHttpUrlError(url), url).not.toBeNull()
      expect(sanitizeStoredSourceUrl(url), url).toBeUndefined()
    }
  })
})
