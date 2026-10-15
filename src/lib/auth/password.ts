/**
 * Web Crypto PBKDF2 so password hashing stays inside Workers CPU limits.
 * Better Auth's default scrypt is pure JS on the workerd export and can
 * trip the 10ms Free plan CPU limit. Iterations are stored in the hash,
 * so this number can be raised later without invalidating old passwords.
 */
export const PASSWORD_PBKDF2_ITERATIONS = 20_000
const HASH_BITS = 256
const SALT_BYTES = 16
const PREFIX = "pbkdf2-sha256"

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index]
  }
  return diff === 0
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    HASH_BITS
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const digest = await derive(password, salt, PASSWORD_PBKDF2_ITERATIONS)
  return [
    PREFIX,
    String(PASSWORD_PBKDF2_ITERATIONS),
    bytesToBase64(salt),
    bytesToBase64(digest),
  ].join("$")
}

export async function verifyPassword(data: {
  hash: string
  password: string
}): Promise<boolean> {
  const parts = data.hash.split("$")
  if (parts.length !== 4 || parts[0] !== PREFIX) return false
  const iterations = Number(parts[1])
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 1_000_000
  ) {
    return false
  }
  const salt = base64ToBytes(parts[2] ?? "")
  const expected = base64ToBytes(parts[3] ?? "")
  if (!salt || !expected) return false
  const actual = await derive(data.password, salt, iterations)
  return safeEqual(actual, expected)
}
