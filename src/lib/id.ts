type IdCrypto = {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array) => Uint8Array
}

function webCrypto(): IdCrypto | undefined {
  return (globalThis as typeof globalThis & { crypto?: IdCrypto }).crypto
}

function uuidFromRandomValues(bytes: Uint8Array): string {
  const value = new Uint8Array(16)
  value.set(bytes.subarray(0, 16))
  value[6] = (value[6] & 0x0f) | 0x40
  value[8] = (value[8] & 0x3f) | 0x80
  const hex = Array.from(value, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function timestampRandomId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`
}

export function createId(
  prefix: string,
  source: IdCrypto | undefined = webCrypto()
): string {
  if (typeof source?.randomUUID === "function") {
    return `${prefix}-${source.randomUUID()}`
  }
  if (typeof source?.getRandomValues === "function") {
    return `${prefix}-${uuidFromRandomValues(source.getRandomValues(new Uint8Array(16)))}`
  }
  return `${prefix}-${timestampRandomId()}`
}
