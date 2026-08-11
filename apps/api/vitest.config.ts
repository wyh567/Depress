import { defineConfig } from "vitest/config";

// The runtime-role and artifact-cleanup permission integration suites both
// create and drop cluster-global, production-named PostgreSQL roles
// (depress_api, depress_outbox, depress_pointer_worker, depress_cleanup).
// PostgreSQL roles are not scoped to a database, so if Vitest's default
// per-file parallelism ran both suites at once against the same admin
// connection, they could race on role creation/teardown regardless of how
// carefully each suite tracks its own resource ownership.
//
// Ordinary test runs are unaffected: file parallelism stays enabled unless the
// permission opt-in is explicitly present, matching the same
// DEPRESS_POSTGRES_PERMISSION_TEST flag the suites themselves require before
// running any destructive SQL.
const permissionTestOptIn = process.env["DEPRESS_POSTGRES_PERMISSION_TEST"] === "1";

export default defineConfig({
  test: {
    fileParallelism: !permissionTestOptIn,
  },
});
