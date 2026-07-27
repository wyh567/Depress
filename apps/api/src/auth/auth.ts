import { betterAuth } from "better-auth";
import type { Pool } from "pg";

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

export interface MentorAuthOptions {
  secret: string;
  origin: string;
  isProduction: boolean;
  allowSignUp?: boolean;
}

function requireSecret(secret: string): string {
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

function requireOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("AUTH_ORIGIN must be an HTTP(S) origin without a path");
  }
  return origin;
}

export function createMentorAuth(pool: Pool, options: MentorAuthOptions) {
  const origin = requireOrigin(options.origin);
  const secure = options.isProduction;

  return betterAuth({
    database: pool,
    secret: requireSecret(options.secret),
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.allowSignUp !== true,
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: {
        enabled: false,
      },
    },
    advanced: {
      cookiePrefix: "depress",
      useSecureCookies: secure,
      defaultCookieAttributes: {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
      },
    },
  });
}

export type MentorAuth = ReturnType<typeof createMentorAuth>;
