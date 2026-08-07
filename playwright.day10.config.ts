import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

const externalRoot = process.env.DAY10_EXTERNAL_ROOT ?? "D:\\depress-day10-wsl";
const envFile = process.env.DAY10_E2E_ENV_FILE ?? `${externalRoot}\\e2e.env`;

for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/u)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (process.env[key] === undefined) process.env[key] = value;
}

const required = [
  "DAY10_BASE_URL",
  "DAY10_MENTOR_A_EMAIL",
  "DAY10_MENTOR_A_PASSWORD",
  "DAY10_MENTOR_B_EMAIL",
  "DAY10_MENTOR_B_PASSWORD",
] as const;

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required Day 10 setting: ${key}`);
}

export default defineConfig({
  testDir: "./e2e/day10",
  outputDir: process.env.DAY10_TEST_OUTPUT_DIR ?? `${externalRoot}\\test-results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["line"]],
  use: {
    baseURL: process.env.DAY10_BASE_URL,
    ignoreHTTPSErrors: true,
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: process.env.DAY10_TRACE === "retain-on-failure" ? "retain-on-failure" : "off",
    screenshot: "off",
    video: "off",
    launchOptions: process.env.DAY10_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.DAY10_CHROMIUM_EXECUTABLE }
      : process.platform === "win32"
        ? {
            executablePath:
              "D:\\depress-day10-wsl\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
          }
        : undefined,
  },
});
