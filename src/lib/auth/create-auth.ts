import { betterAuth } from "better-auth"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import {
  sendResetPassword,
  sendVerificationEmail,
} from "@/lib/auth/email-hooks"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import type { AppD1Database } from "@/lib/db/d1"

export type CreateAuthOptions = {
  db: AppD1Database
  secret: string
  baseURL?: string
  /** TanStack cookie bridge. Tests omit it so they don't need a request scope. */
  cookies?: boolean
  rateLimit?: boolean
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    database: options.db,
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.baseURL ? [options.baseURL] : undefined,
    telemetry: { enabled: false },
    rateLimit: { enabled: options.rateLimit ?? true },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
      // Hook is present; calling reset throws until a mailer is attached.
      sendResetPassword: async () => {
        await sendResetPassword()
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async () => {
        await sendVerificationEmail()
      },
    },
    plugins: options.cookies ? [tanstackStartCookies()] : [],
  })
}

export type Auth = ReturnType<typeof createAuth>
