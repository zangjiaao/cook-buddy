/**
 * Email verification and password reset are intentionally not wired to a
 * provider yet. Pass these into Better Auth when a mailer exists:
 * - emailVerification.sendVerificationEmail
 * - emailAndPassword.sendResetPassword
 */
export async function sendVerificationEmail(): Promise<void> {
  throw new Error("邮件验证尚未开放")
}

export async function sendResetPassword(): Promise<void> {
  throw new Error("找回密码尚未开放")
}
