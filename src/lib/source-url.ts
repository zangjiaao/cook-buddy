const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
])

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".")
  if (parts.length !== 4) return false
  if (parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const nums = parts.map((part) => Number(part))
  if (nums.some((num) => num > 255)) return false
  const [a, b] = nums
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

function isPrivateIpv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase()
  if (!bare.includes(":")) return false
  if (bare === "::" || bare === "::1") return true
  if (bare.startsWith("::ffff:")) return true
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true
  if (/^fe[89ab]/.test(bare)) return true
  return false
}

function embedsPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\./.exec(host)
  return Boolean(match && isPrivateIpv4(match[1]))
}

export function publicHttpUrlError(input: string): string | null {
  if (input.length === 0 || input.length > 2000) return "地址无效"
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return "地址无效"
  }
  if (url.username || url.password) return "不读取带账号的地址"
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "只允许 http 或 https"
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  const bare = host.replace(/^\[|\]$/g, "")
  if (!bare) return "地址无效"
  if (
    BLOCKED_HOSTS.has(bare) ||
    bare.endsWith(".local") ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".localdomain") ||
    bare.endsWith(".internal")
  ) {
    return "不读取内网或本机地址"
  }
  if (isPrivateIpv4(bare) || isPrivateIpv6(host) || embedsPrivateIpv4(bare)) {
    return "不读取内网或本机地址"
  }
  return null
}

export function sanitizeStoredSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (publicHttpUrlError(trimmed)) return undefined
  const url = new URL(trimmed)
  url.hash = ""
  return url.href
}

export function sourceUrlHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, "").replace(/^www\./, "")
  } catch {
    return ""
  }
}
