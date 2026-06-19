import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  signContract,
  validateContract,
  trustedKeysPath,
  type TrustedKeys,
} from "../src/lib/contract-signing.ts";

function tempDir(name: string): string {
  const dir = join(tmpdir(), `${name}-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function writeTrustedKeys(projectRoot: string, keys: TrustedKeys): void {
  writeFileSync(trustedKeysPath(projectRoot), `${JSON.stringify(keys, null, 2)}\n`);
}

describe("contract-signing", () => {
  test("signs and verifies a contract with a trusted Ed25519 key", async () => {
    const dir = tempDir("kimi-contract-valid");
    try {
      const keys = keyPair();
      const contract = join(dir, "provider.contract.json");
      writeFileSync(
        contract,
        JSON.stringify({ provider: "cloudflare", service: "access", permissions: ["read"] })
      );
      writeTrustedKeys(dir, { "schema-team": { publicKey: keys.publicKeyPem, roles: ["schema"] } });

      await signContract(contract, "schema-team", keys.privateKeyPem);
      const result = await validateContract(contract, dir);

      expect(result.status).toBe("valid");
      expect(result.trusted).toBe(true);
      expect(result.recognizedSigner).toBe("schema-team");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails validation when signed contract data is tampered", async () => {
    const dir = tempDir("kimi-contract-tamper");
    try {
      const keys = keyPair();
      const contract = join(dir, "provider.contract.json");
      writeFileSync(contract, JSON.stringify({ provider: "cloudflare", version: 1 }));
      writeTrustedKeys(dir, { "schema-team": { publicKey: keys.publicKeyPem } });

      await signContract(contract, "schema-team", keys.privateKeyPem);
      writeFileSync(contract, JSON.stringify({ provider: "cloudflare", version: 2 }));

      await expect(validateContract(contract, dir)).rejects.toThrow("payload hash");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flags unknown signing keys without rejecting by default", async () => {
    const dir = tempDir("kimi-contract-unknown");
    try {
      const keys = keyPair();
      const contract = join(dir, "provider.contract.json");
      writeFileSync(contract, JSON.stringify({ provider: "cloudflare", version: 1 }));
      writeTrustedKeys(dir, {});

      await signContract(contract, "outside-team", keys.privateKeyPem);
      const result = await validateContract(contract, dir);

      expect(result.status).toBe("unknown-key");
      expect(result.trusted).toBe(false);
      await expect(validateContract(contract, dir, { strict: true })).rejects.toThrow(
        "outside-team"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
