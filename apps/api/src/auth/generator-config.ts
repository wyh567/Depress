import { createPostgresPool } from "../db/pool";
import { createMentorAuth } from "./auth";

function requireGeneratorEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Better Auth schema generation`);
  return value;
}

const pool = createPostgresPool(requireGeneratorEnv("DATABASE_URL"));

export const auth = createMentorAuth(pool, {
  secret: requireGeneratorEnv("BETTER_AUTH_SECRET"),
  origin: requireGeneratorEnv("AUTH_ORIGIN"),
  isProduction: process.env["NODE_ENV"] === "production",
});
