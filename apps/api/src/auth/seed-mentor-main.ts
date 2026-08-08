import { createPostgresPool } from "../db/pool";
import { seedMentorAccount } from "./seed-mentor";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const pool = createPostgresPool(requireEnv("DATABASE_URL"));
  try {
    const result = await seedMentorAccount(
      pool,
      {
        secret: requireEnv("BETTER_AUTH_SECRET"),
        origin: requireEnv("AUTH_ORIGIN"),
        isProduction: process.env["NODE_ENV"] === "production",
      },
      {
        email: requireEnv("MENTOR_EMAIL"),
        password: requireEnv("MENTOR_PASSWORD"),
        name: requireEnv("MENTOR_NAME"),
      },
    );
    console.log(`mentor_seed=${result.created ? "created" : "existing"} default_project=ready`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Mentor seed failed");
  process.exit(1);
});
