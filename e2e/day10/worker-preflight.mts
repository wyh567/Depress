import { createRequire } from "node:module";

const checkName = process.argv[2];
const apiRoot = "file:///opt/depress/current/apps/api";

type WorkerEnv = {
  DATABASE_URL: string;
  REDIS_URL?: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
};

type EnvModule = {
  parsePointerWorkerEnv(source: unknown): WorkerEnv;
  redisConnection(env: WorkerEnv): Record<string, unknown>;
};

async function envModule(): Promise<EnvModule> {
  return (await import(`${apiRoot}/src/env.ts`)) as EnvModule;
}

switch (checkName) {
  case "config": {
    const runtimeEnv = await envModule();
    runtimeEnv.parsePointerWorkerEnv(process.env);
    break;
  }
  case "postgres": {
    const database = (await import(`${apiRoot}/src/db/pool.ts`)) as {
      createPostgresPool(url: string): {
        query(sql: string): Promise<unknown>;
        end(): Promise<void>;
      };
    };
    const pool = database.createPostgresPool(process.env.DATABASE_URL ?? "");
    try {
      await pool.query("SELECT 1");
    } finally {
      await pool.end();
    }
    break;
  }
  case "redis": {
    const runtimeEnv = await envModule();
    const parsed = runtimeEnv.parsePointerWorkerEnv(process.env);
    const requireFromApi = createRequire("/opt/depress/current/apps/api/package.json");
    const bullmq = requireFromApi("bullmq") as {
      Queue: new (
        name: string,
        options: { connection: Record<string, unknown> }
      ) => {
        waitUntilReady(): Promise<unknown>;
        close(): Promise<void>;
      };
    };
    const queue = new bullmq.Queue("day10-pointer-worker-preflight", {
      connection: runtimeEnv.redisConnection(parsed),
    });
    try {
      await queue.waitUntilReady();
    } finally {
      await queue.close();
    }
    break;
  }
  case "s3": {
    const storage = (await import(`${apiRoot}/src/services/s3.ts`)) as {
      createS3ArtifactService(): unknown;
    };
    storage.createS3ArtifactService();
    break;
  }
  default:
    process.exitCode = 64;
}
