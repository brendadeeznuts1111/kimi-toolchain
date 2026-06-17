import { makeDir, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  buildIdentitySwitchPlan,
  detectIdentityProfile,
  parseIdentityMatrixToml,
  readIdentityAudit,
  writeIdentityProfileToDxConfig,
  appendIdentityAuditRecord,
  upsertIdentityProfileToml,
} from "../src/lib/identity-matrix.ts";
import { identityAuditPath } from "../src/lib/paths.ts";

const MATRIX_TOML = `
[identity.profiles.personal]
userName = "Brenda Williams"
userEmail = "205237647+brendadeeznuts1111@users.noreply.github.com"
remotePatterns = ["github.com/brendadeeznuts1111/*"]
pathPatterns = ["~/kimi-toolchain"]

[identity.profiles.work]
userName = "DuoPlus Development Team"
userEmail = "dev@duoplus.com"
remotePatterns = []
pathPatterns = ["~/Work/*"]
`;

describe("identity-matrix", () => {
  test("parses DX identity profiles", () => {
    const matrix = parseIdentityMatrixToml(MATRIX_TOML);

    expect(matrix.profiles.map((profile) => profile.name)).toEqual(["personal", "work"]);
    expect(matrix.profiles[0]?.userEmail).toContain("users.noreply.github.com");
  });

  test("detects by path before remote", () => {
    const matrix = parseIdentityMatrixToml(MATRIX_TOML);
    const detection = detectIdentityProfile({
      matrix,
      repoPath: "~/kimi-toolchain",
      remoteUrl: "git@github.com:someone-else/repo.git",
    });

    expect(detection.match).toBe("path");
    expect(detection.profile?.name).toBe("personal");
  });

  test("detects SSH remotes after normalization", () => {
    const matrix = parseIdentityMatrixToml(MATRIX_TOML);
    const detection = detectIdentityProfile({
      matrix,
      repoPath: "/tmp/elsewhere",
      remoteUrl: "git@github.com:brendadeeznuts1111/kimi-toolchain.git",
    });

    expect(detection.match).toBe("remote");
    expect(detection.profile?.name).toBe("personal");
  });

  test("returns no match for unknown repo context", () => {
    const matrix = parseIdentityMatrixToml(MATRIX_TOML);
    const detection = detectIdentityProfile({
      matrix,
      repoPath: "/tmp/elsewhere",
      remoteUrl: "https://github.com/example/repo.git",
    });

    expect(detection.match).toBe("none");
  });

  test("builds a local git switch plan with signing and SSH metadata", () => {
    const matrix = parseIdentityMatrixToml(`
[identity.profiles.work]
userName = "DuoPlus Development Team"
userEmail = "dev@duoplus.com"
sshKey = "~/.ssh/id_work"
signingKey = "ABC123"
gpgSign = true
remotePatterns = []
pathPatterns = ["~/Work/*"]
`);
    const profile = matrix.profiles[0]!;
    const plan = buildIdentitySwitchPlan({
      profile,
      repoPath: "~/Work/app",
      previousIdentity: { userName: "Old", userEmail: "old@example.com" },
    });

    expect(plan.commands).toContainEqual([
      "git",
      "config",
      "--local",
      "user.name",
      profile.userName,
    ]);
    expect(plan.commands).toContainEqual(["git", "config", "--local", "commit.gpgSign", "true"]);
    expect(plan.newIdentity.sshCommand).toContain("id_work");
  });

  test("reads audit records with malformed-line tolerance", async () => {
    const root = join(import.meta.dir, "..", `.tmp-identity-audit-${Date.now()}`);
    makeDir(join(root, ".kimi"), { recursive: true });
    try {
      await Bun.write(identityAuditPath(root), "{bad-json}\n");
      const written = await appendIdentityAuditRecord(root, {
        repoPath: root,
        newProfile: "personal",
        reason: "test",
        previousIdentity: {},
        newIdentity: { userName: "Brenda Williams" },
      });

      const records = await readIdentityAudit(root);
      expect(records).toEqual([written]);
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  });

  test("upserts a single profile section in DX TOML", async () => {
    const root = join(import.meta.dir, "..", `.tmp-identity-dx-${Date.now()}`);
    const path = join(root, "global-config.toml");
    makeDir(root, { recursive: true });
    try {
      const profile = parseIdentityMatrixToml(MATRIX_TOML).profiles[0]!;
      await writeIdentityProfileToDxConfig(path, profile);
      await writeIdentityProfileToDxConfig(path, { ...profile, sshKey: "/tmp/id_ed25519" });

      const text = await Bun.file(path).text();
      expect(text.match(/\[identity\.profiles\.personal\]/g)?.length).toBe(1);
      expect(text).toContain('sshKey = "/tmp/id_ed25519"');
      expect(upsertIdentityProfileToml(text, profile)).toContain("userName");
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  });
});
