import type { Pool } from "pg";
import { createProjectRepository } from "../db/project-repository";
import { createMentorAuth, type MentorAuthOptions } from "./auth";

export interface MentorSeedInput {
  email: string;
  password: string;
  name: string;
}

export interface MentorSeedResult {
  created: boolean;
  userId: string;
  defaultProjectId: string;
}

function requireSeedValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

async function findUserId(pool: Pool, email: string): Promise<string | undefined> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE lower(email) = lower($1)`,
    [email],
  );
  if (result.rows.length > 1) throw new Error("MENTOR_ACCOUNT_INVARIANT_FAILED");
  return result.rows[0]?.id;
}

export async function seedMentorAccount(
  pool: Pool,
  authOptions: Omit<MentorAuthOptions, "allowSignUp">,
  input: MentorSeedInput,
): Promise<MentorSeedResult> {
  const email = requireSeedValue(input.email, "MENTOR_EMAIL").toLowerCase();
  const password = requireSeedValue(input.password, "MENTOR_PASSWORD");
  const name = requireSeedValue(input.name, "MENTOR_NAME");

  let userId = await findUserId(pool, email);
  let created = false;

  if (!userId) {
    const seedOnlyAuth = createMentorAuth(pool, {
      ...authOptions,
      allowSignUp: true,
    });
    const result = await seedOnlyAuth.api.signUpEmail({
      body: { email, password, name },
    });
    userId = result.user.id;
    created = true;
  }

  const project = await createProjectRepository(pool).getOrCreateDefaultProject(userId);
  return {
    created,
    userId,
    defaultProjectId: project.id,
  };
}
