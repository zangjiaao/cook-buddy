import { describe, expect, test } from "vitest"
import { hashPassword, verifyPassword } from "@/lib/auth/password"

describe("密码哈希", () => {
  test("正确密码能通过，错误密码不能", async () => {
    const hash = await hashPassword("kitchen-secret")
    expect(hash.startsWith("pbkdf2-sha256$")).toBe(true)
    expect(await verifyPassword({ hash, password: "kitchen-secret" })).toBe(
      true
    )
    expect(await verifyPassword({ hash, password: "wrong-password" })).toBe(
      false
    )
  })

  test("坏格式直接拒绝", async () => {
    expect(
      await verifyPassword({ hash: "not-a-hash", password: "kitchen-secret" })
    ).toBe(false)
  })
})
