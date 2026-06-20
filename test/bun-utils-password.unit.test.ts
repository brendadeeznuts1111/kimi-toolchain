import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PASSWORD_OPTIONS,
  getPasswordOptions,
  hashPassword,
  verifyPassword,
} from "../src/lib/bun-utils.ts";

const PLAIN = "super-secure-pa$$word";
const WRONG = "wrong-password";

describe("password hashing wrapper", () => {
  describe("Bun.password.hash() compatibility", () => {
    test("default parameters match the guide implicit default (argon2id, m=65536, t=2)", async () => {
      const hash = await hashPassword(PLAIN, {
        algorithm: "argon2id",
        memoryCost: 65536,
        timeCost: 2,
      });
      expect(hash).toStartWith("$argon2id$v=19$m=65536,t=2,p=1$");
    });

    test("DEFAULT_PASSWORD_OPTIONS matches bare Bun.password.hash costs", async () => {
      const bare = await Bun.password.hash(PLAIN);
      const explicit = await Bun.password.hash(PLAIN, DEFAULT_PASSWORD_OPTIONS);
      const costPrefix = "$argon2id$v=19$m=65536,t=2,p=1$";
      expect(bare).toStartWith(costPrefix);
      expect(explicit).toStartWith(costPrefix);
    });

    test("custom argon2 options from guide (memoryCost: 8, timeCost: 3)", async () => {
      const hash = await hashPassword(PLAIN, {
        algorithm: "argon2id",
        memoryCost: 8,
        timeCost: 3,
      });
      expect(hash).toStartWith("$argon2id$v=19$m=8,t=3,p=1$");
    });

    test("bcrypt with cost: 4 from guide", async () => {
      const hash = await hashPassword(PLAIN, {
        algorithm: "bcrypt",
        cost: 4,
      });
      expect(hash).toStartWith("$2b$04$");
    });
  });

  describe("verifyPassword()", () => {
    test("returns true for correct password with default argon2id hash", async () => {
      const hash = await hashPassword(PLAIN, {
        algorithm: "argon2id",
        memoryCost: 65536,
        timeCost: 2,
      });
      expect(await verifyPassword(PLAIN, hash)).toBe(true);
    });

    test("returns false for incorrect password", async () => {
      const hash = await hashPassword(PLAIN, {
        algorithm: "argon2id",
        memoryCost: 65536,
        timeCost: 2,
      });
      expect(await verifyPassword(WRONG, hash)).toBe(false);
    });

    test("verifies a hash generated directly by Bun.password.hash (interop)", async () => {
      const rawHash = await Bun.password.hash(PLAIN);
      expect(await verifyPassword(PLAIN, rawHash)).toBe(true);
    });

    test("verifies bcrypt hashes", async () => {
      const hash = await hashPassword(PLAIN, {
        algorithm: "bcrypt",
        cost: 4,
      });
      expect(await verifyPassword(PLAIN, hash)).toBe(true);
    });

    test("accepts hashes from prior cost parameters after rotation", async () => {
      const legacyHash = await Bun.password.hash("rotate-me", {
        algorithm: "argon2id",
        memoryCost: 65536,
        timeCost: 2,
      });
      expect(await verifyPassword("rotate-me", legacyHash)).toBe(true);
    });
  });

  describe("environment-specific defaults (getPasswordOptions)", () => {
    test("getPasswordOptions uses test defaults when NODE_ENV=test", () => {
      expect(Bun.env.NODE_ENV).toBe("test");
      expect(getPasswordOptions()).toEqual({
        algorithm: "argon2id",
        memoryCost: 1024,
        timeCost: 1,
      });
    });

    test("in test environment, hash without options uses test defaults (m=1024, t=1)", async () => {
      const hash = await hashPassword(PLAIN);
      expect(hash).toStartWith("$argon2id$v=19$m=1024,t=1,p=1$");
    });

    test("explicitly passing options overrides environment defaults", async () => {
      const hash = await hashPassword(PLAIN, {
        algorithm: "argon2id",
        memoryCost: 65536,
        timeCost: 2,
      });
      expect(hash).toStartWith("$argon2id$v=19$m=65536,t=2,p=1$");
    });
  });

  describe("edge cases and error handling", () => {
    test("invalid algorithm throws (Bun handles it)", async () => {
      await expect(
        (async () =>
          hashPassword(PLAIN, { algorithm: "invalid" } as unknown as Parameters<
            typeof hashPassword
          >[1]))()
      ).rejects.toThrow();
    });

    test("bcrypt cost below minimum (4) is rejected", async () => {
      await expect(
        (async () => hashPassword(PLAIN, { algorithm: "bcrypt", cost: 3 }))()
      ).rejects.toThrow();
    });

    test("argon2 memoryCost below minimum (8) is rejected", async () => {
      await expect(
        (async () => hashPassword(PLAIN, { algorithm: "argon2id", memoryCost: 4 }))()
      ).rejects.toThrow();
    });
  });
});