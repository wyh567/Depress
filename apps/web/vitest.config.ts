import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "components/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
      "stores/**/*.test.{ts,tsx}",
    ],
  },
});
