import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "components/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
      "stores/**/*.test.{ts,tsx}",
    ],
  },
});
