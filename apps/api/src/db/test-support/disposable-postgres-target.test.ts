import { describe, expect, it } from "vitest";
import {
  assertDisposableDatabaseName,
  assertLoopbackHost,
  assertNotProductionDatabaseName,
  assertPermissionTestOptIn,
  databaseNameFromConnectionString,
  PERMISSION_TEST_FLAG,
  ProductionLikeTestTargetError,
} from "./disposable-postgres-target";

// These cases cover the guard layers that decide without a server connection.
// The catalog-backed layers (server version, connected identity, cluster role
// fingerprint, application table fingerprint) are asserted by the opt-in
// permission suites against a real PostgreSQL 16 target.

describe("disposable postgres target guard", () => {
  describe("opt-in", () => {
    it("refuses when the permission-test flag is absent", () => {
      const previous = process.env[PERMISSION_TEST_FLAG];
      delete process.env[PERMISSION_TEST_FLAG];
      try {
        expect(() => assertPermissionTestOptIn()).toThrow(ProductionLikeTestTargetError);
      } finally {
        if (previous !== undefined) process.env[PERMISSION_TEST_FLAG] = previous;
      }
    });

    it("refuses a value other than an exact opt-in", () => {
      const previous = process.env[PERMISSION_TEST_FLAG];
      process.env[PERMISSION_TEST_FLAG] = "true";
      try {
        expect(() => assertPermissionTestOptIn()).toThrow(/is not set/);
      } finally {
        if (previous === undefined) delete process.env[PERMISSION_TEST_FLAG];
        else process.env[PERMISSION_TEST_FLAG] = previous;
      }
    });
  });

  describe("host", () => {
    it("accepts loopback targets", () => {
      expect(() =>
        assertLoopbackHost("postgres://postgres@127.0.0.1:5432/depress_perm_test"),
      ).not.toThrow();
      expect(() =>
        assertLoopbackHost("postgres://postgres@localhost:5432/depress_perm_test"),
      ).not.toThrow();
    });

    it("refuses a remote host", () => {
      expect(() =>
        assertLoopbackHost("postgres://postgres@db.internal.example:5432/depress_perm_test"),
      ).toThrow(/is not loopback/);
    });

    it("refuses an unparsable connection string", () => {
      expect(() => assertLoopbackHost("not a url")).toThrow(/not a parsable URL/);
    });
  });

  describe("production database name", () => {
    it("refuses the production database name", () => {
      expect(() => assertNotProductionDatabaseName("depress", "the connection string")).toThrow(
        /production database name/,
      );
    });

    it("refuses the production database name for a disposable application target", () => {
      expect(() => assertDisposableDatabaseName("depress", "the connection string")).toThrow(
        /production database name/,
      );
    });

    it("extracts the database name from a connection string", () => {
      expect(
        databaseNameFromConnectionString("postgres://postgres@127.0.0.1:5432/depress"),
      ).toBe("depress");
      expect(
        databaseNameFromConnectionString("postgres://postgres@127.0.0.1:5432/postgres"),
      ).toBe("postgres");
    });

    it("permits a maintenance database as an administrative target", () => {
      // The admin connection is not the application target, so it must not be
      // required to carry a disposable application name.
      expect(() => assertNotProductionDatabaseName("postgres", "the connection string")).not.toThrow();
    });
  });

  describe("disposable application database identity", () => {
    it("accepts the name the runtime permission suite generates", () => {
      expect(() =>
        assertDisposableDatabaseName("depress_runtime_perm_0a1b2c3d4e5f6071", "target"),
      ).not.toThrow();
    });

    it("accepts explicit disposable markers", () => {
      for (const name of [
        "depress_cleanup_perm_test",
        "depress_permission_target",
        "depress_test",
        "depress_tmp",
        "scratch_db",
      ]) {
        expect(() => assertDisposableDatabaseName(name, "target")).not.toThrow();
      }
    });

    it("refuses a database that announces no disposable identity", () => {
      for (const name of ["postgres", "depress_production", "app"]) {
        expect(() => assertDisposableDatabaseName(name, "target")).toThrow(
          /carries no disposable identity/,
        );
      }
    });

    it("refuses a connection string that names no database", () => {
      expect(() => assertDisposableDatabaseName("", "target")).toThrow(
        /does not name a database/,
      );
    });
  });
});
